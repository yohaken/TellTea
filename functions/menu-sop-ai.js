/**
 * Bakery SOP costing AI:
 * - extractStockCostsFromBill: OCR bill lines → propose stockCosts unit prices
 * - analyzeMenuSopCost: map SOP ingredients → stock catalog + cost estimate
 *
 * Staff+owner may extract bill lines (no Firestore write here — client confirms stock costs).
 * Staff+owner may analyzeMenuSopCost for ingredient↔stock links (costs stay owner-gated via stockCosts).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  extractJsonObject,
  isAllowedImageUrl,
  DEFAULT_MODEL,
} = require("./classify-ledger");

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const EXTRACT_MAX_IMAGES = 4;
const BOOTSTRAP_GEMINI_API_KEY = "";
const OWNER_EMAIL = "yohaken@gmail.com";

function requireAuth(context) {
  if (!context?.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
}

async function requireOwner(db, context) {
  requireAuth(context);
  const email = String(context.auth.token?.email || "")
    .trim()
    .toLowerCase();
  if (email === OWNER_EMAIL) return;
  if (email) {
    const byEmail = await db.collection("staff").doc(email).get();
    if (byEmail.exists && byEmail.get("role") === "owner") return;
  }
  const uid = context.auth.uid;
  const byUid = await db.collection("staff").doc(uid).get();
  if (byUid.exists && byUid.get("role") === "owner") return;
  throw new functions.https.HttpsError(
    "permission-denied",
    "เฉพาะเจ้าของเท่านั้น",
  );
}

async function loadAiSettings(db) {
  const snap = await db.doc("meta/aiSettings").get();
  const data = snap.exists ? snap.data() : {};
  const enabled = data.enabled !== false;
  const model = String(data.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const apiKey =
    String(process.env.GEMINI_API_KEY || "").trim() ||
    String(data.apiKey || "").trim() ||
    BOOTSTRAP_GEMINI_API_KEY;
  return { enabled, model, apiKey };
}

function partFromDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/,
  );
  if (!m) throw new Error("data URL ไม่ถูกต้อง");
  const mimeType = m[1].toLowerCase();
  const data = m[2];
  const approxBytes = Math.floor((data.length * 3) / 4);
  if (!data || approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("รูปใหญ่เกินไป");
  }
  return { inlineData: { mimeType, data } };
}

function mimeFromResponse(contentType, url) {
  const ct = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (ct.startsWith("image/")) return ct;
  const path = String(url || "").toLowerCase();
  if (path.includes(".png")) return "image/png";
  if (path.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

async function fetchImagePart(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`โหลดรูปไม่สำเร็จ (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("รูปว่าง");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("รูปใหญ่เกินไป");
  return {
    inlineData: {
      mimeType: mimeFromResponse(res.headers.get("content-type"), url),
      data: buf.toString("base64"),
    },
  };
}

async function resolveImagePart(db, ref) {
  const raw = String(ref || "").trim();
  if (!raw) throw new Error("ไม่มีรูป");
  if (raw.startsWith("evp:")) {
    const id = raw.slice(4).trim();
    if (!id || id.length > 80) throw new Error("รหัสรูปไม่ถูกต้อง");
    const snap = await db.doc(`evidencePhotos/${id}`).get();
    if (!snap.exists) throw new Error("ไม่พบรูปในคลังหลักฐาน");
    return partFromDataUrl(String(snap.data()?.dataUrl || ""));
  }
  if (raw.startsWith("data:image/")) return partFromDataUrl(raw);
  if (isAllowedImageUrl(raw)) return fetchImagePart(raw);
  throw new Error("รองรับเฉพาะรูปหลักฐานหรือลิงก์ Storage");
}

async function callGeminiJson({ apiKey, model, imageParts, systemText, userText }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [];
  if (systemText) parts.push({ text: systemText });
  if (userText) parts.push({ text: userText });
  for (const p of imageParts || []) parts.push(p);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "");
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI ตอบไม่ใช่ JSON");
  }
  return parsed;
}

function normalizeStockCatalog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const d = row && typeof row === "object" ? row : {};
      const aliases = Array.isArray(d.aliases)
        ? d.aliases.map((a) => String(a || "").trim()).filter(Boolean).slice(0, 20)
        : [];
      return {
        id: String(d.id || "").trim(),
        name: String(d.name || "").trim(),
        unit: String(d.unit || "").trim() || "ก.",
        unitCost: Number(d.unitCost) || 0,
        aliases,
      };
    })
    .filter((r) => r.id && r.name)
    .slice(0, 200);
}

function catalogAliasIndex(catalog) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const byName = new Map();
  for (const c of catalog) {
    byName.set(c.name.toLowerCase(), c);
    for (const a of c.aliases || []) {
      byName.set(String(a).toLowerCase(), c);
    }
  }
  return { byId, byName };
}

function normalizeBillLines(parsed, catalog) {
  const { byId, byName } = catalogAliasIndex(catalog);
  const raw = Array.isArray(parsed?.lines) ? parsed.lines : [];
  return raw
    .map((row) => {
      const d = row && typeof row === "object" ? row : {};
      const name = String(d.name || "").trim().slice(0, 120);
      if (!name) return null;
      const price = Number(d.price);
      const packSize = Number(d.packSize);
      let unitCost = Number(d.unitCost);
      const packUnit = String(d.packUnit || "").trim().slice(0, 20);
      let baseUnit = String(d.baseUnit || "ก.").trim().slice(0, 20) || "ก.";
      if (
        !(unitCost > 0) &&
        Number.isFinite(price) &&
        price > 0 &&
        Number.isFinite(packSize) &&
        packSize > 0
      ) {
        unitCost = Math.round((price / packSize) * 100000) / 100000;
      }
      let matchId = String(d.matchStockItemId || "").trim() || null;
      let matchName = String(d.matchStockName || "").trim() || null;
      if (matchId && !byId.has(matchId)) matchId = null;
      if (!matchId && matchName) {
        const hit = byName.get(matchName.toLowerCase());
        if (hit) {
          matchId = hit.id;
          matchName = hit.name;
        }
      }
      if (!matchId) {
        const hit = byName.get(name.toLowerCase());
        if (hit) {
          matchId = hit.id;
          matchName = hit.name;
        }
      }
      return {
        name,
        packSize: Number.isFinite(packSize) && packSize > 0 ? packSize : null,
        packUnit,
        price: Number.isFinite(price) && price > 0 ? price : null,
        unitCost: Number.isFinite(unitCost) && unitCost > 0 ? unitCost : null,
        baseUnit,
        matchStockItemId: matchId,
        matchStockName: matchName,
        confidence: Math.min(1, Math.max(0, Number(d.confidence) || 0)),
        note: String(d.note || "").trim().slice(0, 120),
      };
    })
    .filter(Boolean)
    .slice(0, 40);
}

exports.extractStockCostsFromBill = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const db = getFirestore();
    // พนักงานแนบบิลแยกรายการได้ — ไม่เขียน stockCosts (เจ้าของยืนยันฝั่ง client)
    requireAuth(context);

    const settings = await loadAiSettings(db);
    if (!settings.enabled) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ปิดการจัดประเภทด้วย AI อยู่",
      );
    }
    if (!settings.apiKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่มี API key — ตั้งค่าในแผง AI ของสมุดบัญชี",
      );
    }

    const imageRefs = (
      Array.isArray(data?.imageRefs) ? data.imageRefs : []
    )
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, EXTRACT_MAX_IMAGES);
    if (!imageRefs.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "ต้องมีรูปอย่างน้อย 1 รูป",
      );
    }

    const catalog = normalizeStockCatalog(data?.stockCatalog);
    const model = String(data?.model || "").trim() || settings.model;

    const imageParts = [];
    for (const ref of imageRefs) {
      try {
        imageParts.push(await resolveImagePart(db, ref));
      } catch (err) {
        console.warn("skip image", err?.message || err);
      }
    }
    if (!imageParts.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "อ่านรูปไม่สำเร็จ",
      );
    }

    const catalogText = catalog.length
      ? catalog
          .map((c) => {
            const al =
              c.aliases && c.aliases.length
                ? ` · aliases=${c.aliases.join("|")}`
                : "";
            return `- id=${c.id} · ${c.name} · หน่วย=${c.unit}${al}`;
          })
          .join("\n")
      : "(ยังไม่มีรายการคลัง)";

    const systemText = `คุณเป็นผู้ช่วยอ่านใบเสร็จวัตถุดิบร้านเบเกอรี่/เครื่องดื่มไทย
ดึงรายการสินค้าจากใบกำกับ/ใบเสร็จ (ข้ามสลิปโอนเงิน) แล้วคำนวณราคาต่อหน่วยฐานสำหรับ stockCosts

ตอบ JSON เท่านั้น:
{"lines":[{"name":"ชื่อสินค้า","packSize":จำนวนในแพ็กเป็นตัวเลขหรือ null,"packUnit":"ก.|มล.|ชิ้น|ถุง|กก.","price":ราคารวมบรรทัด,"unitCost":ราคาต่อหน่วยฐาน,"baseUnit":"ก. หรือ มล. หรือ ชิ้น","matchStockItemId":"id จากแคตตาล็อกหรือ null","matchStockName":"ชื่อจากแคตตาล็อกหรือ null","confidence":0ถึง1,"note":"สั้นๆ"}],"reason":"สรุปสั้นๆ"}

กฎ:
- ดึงทุกบรรทัดสินค้าที่เห็นบนบิลไว้ใน lines (รวมของที่ไม่แน่ใจ) — อย่าตัดทิ้งเงียบๆ
- confidence = ความมั่นใจว่าเป็นวัตถุดิบ/ของใช้ทำเครื่องดื่มหรือเบเกอรี่ (0–1)
  · ≥0.7 ของที่ชัดว่าเป็นวัตถุดิบ (แป้ง นม ไซรัป ผงชา ฯลฯ)
  · <0.7 ของกำกวม แต่ยังอยู่ในรายชื่อ (ใส่ note สั้นๆ เช่น "ไม่แน่ใจ")
  · วัสดุบรรจุ (ถุง หลอด แก้ว ฝา) ใส่ confidence ต่ำและ note="บรรจุ"
- ข้ามสลิปโอน / QR เท่านั้น (ไม่ใส่ใน lines)
- ถ้าแพ็กเป็น กก. ให้ packSize เป็นกรัม (เช่น 1กก.=1000) และ baseUnit="ก." เมื่อหน่วยคลังเป็นกรัม
- unitCost = price / packSize เมื่อคำนวณได้
- จับคู่แคตตาล็อกจากชื่อหรือ aliases ถ้าใกล้เคียงเท่านั้น ห้ามเดา id ที่ไม่มีในรายการ
- ยี่ห้อต่างกันของวัตถุดิบชนิดเดียวกัน = รายการคลังเดียวกัน (ใช้ aliases)
- ห้ามแต่งตัวเลขที่มองไม่เห็นบนบิล`;

    const userText = `แคตตาล็อกคลังปัจจุบัน:
${catalogText}

อ่านรายการวัตถุดิบจากรูปใบเสร็จด้านล่าง`;

    const parsed = await callGeminiJson({
      apiKey: settings.apiKey,
      model,
      imageParts,
      systemText,
      userText,
    });

    return {
      lines: normalizeBillLines(parsed, catalog),
      model,
      usedImages: imageParts.length,
      reason: String(parsed.reason || "").trim().slice(0, 160),
    };
  });

exports.analyzeMenuSopCost = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const db = getFirestore();
    // พนักงานจับคู่ส่วนผสม↔คลังได้ — ต้นทุนจริงยังอยู่ stockCosts (เจ้าของ)
    requireAuth(context);

    const settings = await loadAiSettings(db);
    if (!settings.enabled) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ปิดการจัดประเภทด้วย AI อยู่",
      );
    }
    if (!settings.apiKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่มี API key — ตั้งค่าในแผง AI ของสมุดบัญชี",
      );
    }

    const sop = data?.sop && typeof data.sop === "object" ? data.sop : {};
    const ingredients = Array.isArray(sop.ingredients) ? sop.ingredients : [];
    const ingredientsText = String(sop.ingredientsText || "").trim();
    if (!ingredients.length && !ingredientsText) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "ต้องมีส่วนผสมใน SOP (ข้อความหรือรายการ)",
      );
    }

    const catalog = normalizeStockCatalog(data?.stockCatalog);
    const model = String(data?.model || "").trim() || settings.model;

    const ingText = ingredients.length
      ? ingredients
          .map((ing) => {
            const d = ing && typeof ing === "object" ? ing : {};
            return `- id=${d.id} · ${d.nameFreeText || d.name} · ${d.qty || 0} ${d.unit || ""}`;
          })
          .join("\n")
      : `(จากข้อความ)\n${ingredientsText}`;

    const steps = Array.isArray(sop.steps) ? sop.steps : [];
    const stepText = steps
      .map((s, i) => {
        const d = s && typeof s === "object" ? s : {};
        return `${i + 1}. ${d.title || ""}: ${d.body || ""}`;
      })
      .join("\n");

    const catalogText = catalog
      .map((c) => {
        const al =
          c.aliases && c.aliases.length
            ? ` · aliases=${c.aliases.join("|")}`
            : "";
        return `- id=${c.id} · ${c.name} · หน่วย=${c.unit} · unitCost=${c.unitCost}${al}`;
      })
      .join("\n");

    const yieldQty = Number(sop.yieldQty) > 0 ? Number(sop.yieldQty) : 1;

    const systemText = `คุณเป็นผู้ช่วยวิเคราะห์ต้นทุนเมนูเบเกอรี่/เครื่องดื่ม
แปลงข้อความส่วนผสมเป็นรายการ แล้วจับคู่กับคลังหรือเบส (ชื่อหรือ aliases) เพื่อประมาณต้นทุน

ตอบ JSON เท่านั้น:
{"links":[{"ingredientId":"ถ้ามีจากรายการเดิม ไม่งั้นสร้าง id สั้นๆ","ingredientName":"...","stockItemId":"id จากแคตตาล็อกหรือ null","stockName":"... หรือ null","qty":จำนวนใช้,"unit":"ก.","note":"สั้นๆ"}],"batchCostEstimate":ตัวเลขหรือ null,"perPieceEstimate":ตัวเลขหรือ null,"reason":"สรุปสั้นๆ"}

กฎ:
- ถ้าได้ข้อความบรรยาย ให้แยกเป็นบรรทัดส่วนผสมพร้อม qty/หน่วย
- ใช้ stockItemId จากแคตตาล็อกเท่านั้น (จับจากชื่อหรือ aliases) — ห้ามแต่ง id
- รายการที่ id ขึ้นต้นด้วย "base:" คือเบส (สูตรผสมแล้ว ใช้ในเมนูอื่น) — จับคู่ได้เหมือนคลัง
- qty ใช้ตาม SOP ถ้าสมเหตุสมผล
- batchCostEstimate = ผลรวม qty×unitCost ของรายการที่จับคู่ได้ (เบส unitCost อาจเป็น 0)
- perPieceEstimate = batch / yieldQty
- ถ้าจับคู่ไม่ได้ ให้ stockItemId=null และอธิบายใน note (รายการที่ขาด)`;

    const userText = `เมนู: ${sop.name || ""}
ได้ต่อสูตร: ${yieldQty} ${sop.yieldUnit || "ชิ้น"}
น้ำหนักต่อชิ้น: ${sop.pieceWeightG || "-"} ก.
ข้อความส่วนผสมดิบ: ${ingredientsText || "-"}

ส่วนผสม:
${ingText}

ขั้นตอน:
${stepText || "-"}

แคตตาล็อกคลัง + เบส (id ขึ้นต้น base: = เบส) + unitCost:
${catalogText || "(ว่าง)"}`;

    const parsed = await callGeminiJson({
      apiKey: settings.apiKey,
      model,
      imageParts: [],
      systemText,
      userText,
    });

    const byId = new Map(catalog.map((c) => [c.id, c]));
    const rawLinks = Array.isArray(parsed.links) ? parsed.links : [];
    const links = rawLinks
      .map((row) => {
        const d = row && typeof row === "object" ? row : {};
        let stockItemId = String(d.stockItemId || "").trim() || null;
        if (stockItemId && !byId.has(stockItemId)) stockItemId = null;
        const stock = stockItemId ? byId.get(stockItemId) : null;
        return {
          ingredientId: String(d.ingredientId || "").trim(),
          ingredientName: String(d.ingredientName || "").trim(),
          stockItemId,
          stockName: stock?.name || (d.stockName ? String(d.stockName) : null),
          qty: Number(d.qty) || 0,
          unit: String(d.unit || "ก.").trim() || "ก.",
          note: String(d.note || "").trim().slice(0, 120),
        };
      })
      .filter((l) => l.ingredientId)
      .slice(0, 40);

    let batch = Number(parsed.batchCostEstimate);
    if (!Number.isFinite(batch)) {
      batch = 0;
      for (const l of links) {
        const c = l.stockItemId ? byId.get(l.stockItemId) : null;
        if (c && c.unitCost > 0 && l.qty > 0) batch += l.qty * c.unitCost;
      }
      batch = Math.round(batch * 100) / 100;
    }
    let piece = Number(parsed.perPieceEstimate);
    if (!Number.isFinite(piece) && yieldQty > 0) {
      piece = Math.round((batch / yieldQty) * 100) / 100;
    }

    return {
      links,
      batchCostEstimate: Number.isFinite(batch) ? batch : null,
      perPieceEstimate: Number.isFinite(piece) ? piece : null,
      model,
      reason: String(parsed.reason || "").trim().slice(0, 200),
    };
  });
