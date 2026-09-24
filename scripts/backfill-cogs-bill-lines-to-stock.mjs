/**
 * Backfill: บิลประเภทต้นทุน (cogs) ที่มีรูป → AI แยกรายการ → เก็บ billLines
 * → สร้างชื่อใน stock แถบไม่นับ (ไม่ใส่ unitCost)
 *
 * Usage:
 *   node scripts/backfill-cogs-bill-lines-to-stock.mjs [--limit=15] [--dry]
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");
const {
  extractJsonObject,
  DEFAULT_MODEL,
} = require("../functions/classify-ledger.js");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "mypeer-501909",
  });
}
const db = admin.firestore();

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = Math.max(1, Number(limitArg?.split("=")[1] || 15) || 15);
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const PACKAGING_HINT =
  /ถุง|หลอด|แก้ว|ฝา|ฟิล์ม|กระดาษ|โคนไอศ|แก๊ซ|ถ้วยท็อป|ม้วนฝา/i;

function partFromDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/,
  );
  if (!m) throw new Error("data URL ไม่ถูกต้อง");
  const mimeType = m[1].toLowerCase();
  const data = m[2];
  const approxBytes = Math.floor((data.length * 3) / 4);
  if (!data || approxBytes > MAX_IMAGE_BYTES) throw new Error("รูปใหญ่เกินไป");
  return { inlineData: { mimeType, data } };
}

async function resolveImagePart(ref) {
  const raw = String(ref || "").trim();
  if (!raw.startsWith("evp:")) throw new Error("รองรับแค่ evp:");
  const id = raw.slice(4).trim();
  const snap = await db.doc(`evidencePhotos/${id}`).get();
  if (!snap.exists) throw new Error(`ไม่พบรูป ${id}`);
  return partFromDataUrl(String(snap.data()?.dataUrl || ""));
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
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 180)}`);
  }
  const json = await res.json();
  const text = String(
    (json?.candidates?.[0]?.content?.parts || [])
      .map((p) => p?.text || "")
      .join("\n") || "",
  );
  let parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    // salvage truncated JSON array of lines
    const m = text.match(/"lines"\s*:\s*\[([\s\S]*)/);
    if (m) {
      const chunk = m[1];
      const objs = [];
      const re = /\{[^{}]*"name"\s*:\s*"([^"\\]|\\.)*"[^{}]*\}/g;
      let hit;
      while ((hit = re.exec(chunk))) {
        try {
          objs.push(JSON.parse(hit[0]));
        } catch {
          /* skip */
        }
      }
      if (objs.length) parsed = { lines: objs, reason: "salvaged" };
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`AI ไม่ใช่ JSON · ${text.slice(0, 80).replace(/\s+/g, " ")}`);
  }
  return parsed;
}

function normalizeKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function suggestName(billName) {
  let s = String(billName || "").trim();
  if (!s) return "";
  // ตัด prefix หีบ*N ที่ AI ติดมา
  s = s.replace(/^หีบ\s*\*\s*\d+\s*/i, "");
  s = s.split(/\s*[×xX]\s*\d+/)[0] || s;
  s = s.replace(
    /\d[\d,]*\s*(กรัม|ก\.|กก\.?|กิโลกรัม|มล\.?|ลิตร|ล\.|ซม|มิล|ชิ้น|ใบ|เส้น|ฝา|ม้วน|กระป๋อง|ถุง|ขวด).*$/i,
    "",
  );
  s = s.replace(/\(\s*หีบ\s*\*\s*\d+\s*\)\s*$/i, "");
  s = s.replace(/\d[\d,]*\s*$/, "").replace(/\s+/g, " ").trim();
  s = s.replace(/[(\[]\s*$/, "").trim();
  return (s || billName).trim().slice(0, 80);
}

function receiptRefs(data) {
  const urls = [];
  if (Array.isArray(data.receiptUrls)) urls.push(...data.receiptUrls);
  if (data.receiptUrl) urls.push(data.receiptUrl);
  return [...new Set(urls.map(String).map((u) => u.trim()).filter((u) => u.startsWith("evp:")))].slice(0, 4);
}

async function main() {
  const aiSnap = await db.doc("meta/aiSettings").get();
  const ai = aiSnap.exists ? aiSnap.data() : {};
  const apiKey = String(process.env.GEMINI_API_KEY || ai.apiKey || "").trim();
  const model = String(ai.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  if (!apiKey) throw new Error("ไม่มี Gemini API key");

  const stockSnap = await db.collection("stock").get();
  const stockByKey = new Map();
  for (const d of stockSnap.docs) {
    const x = d.data();
    const name = String(x.name || "").trim();
    if (!name) continue;
    stockByKey.set(normalizeKey(name), { id: d.id, name, aliases: x.aliases || [] });
    for (const a of x.aliases || []) {
      const k = normalizeKey(a);
      if (k) stockByKey.set(k, { id: d.id, name, aliases: x.aliases || [] });
    }
  }

  const ledSnap = await db.collection("ledger").orderBy("date", "desc").limit(400).get();
  const candidates = [];
  for (const d of ledSnap.docs) {
    const x = d.data();
    if (String(x.type || "") !== "cogs") continue;
    const refs = receiptRefs(x);
    if (!refs.length) continue;
    const lines = Array.isArray(x.billLines) ? x.billLines : [];
    if (lines.length) continue; // already extracted
    const desc = String(x.description || "");
    // เน้นบิลซื้อของก่อน (ท็อป / แม็คโคร / วัตถุดิบ)
    const score =
      /ท็อป|แม็คโคร|แมคโคร|บัวแดง|แป้ง|น้ำตาล|นม|ไซรัป|ชา|กาแฟ/i.test(desc)
        ? 2
        : 1;
    candidates.push({ id: d.id, desc, refs, score, amountOut: Number(x.amountOut) || 0 });
  }
  candidates.sort((a, b) => b.score - a.score || b.amountOut - a.amountOut);
  const batch = candidates.slice(0, LIMIT);

  console.log(
    JSON.stringify(
      {
        dry,
        limit: LIMIT,
        candidates: candidates.length,
        processing: batch.length,
        sample: batch.slice(0, 5).map((b) => ({ id: b.id, desc: b.desc.slice(0, 40), photos: b.refs.length })),
      },
      null,
      2,
    ),
  );

  const systemText = `คุณเป็นผู้ช่วยอ่านใบเสร็จวัตถุดิบร้านเครื่องดื่ม/เบเกอรี่ไทย
ดึงรายการสินค้าจากใบกำกับ/ใบเสร็จ (ข้ามสลิปโอนเงิน)

ตอบ JSON เท่านั้น:
{"lines":[{"name":"ชื่อสินค้า","packSize":จำนวนหรือ null,"packUnit":"ก.|มล.|ชิ้น|ถุง|กก.","price":ราคารวมหรือ null,"unitCost":ราคาต่อหน่วยหรือ null,"baseUnit":"ก.|มล.|ชิ้น","confidence":0ถึง1,"note":"สั้นๆ"}],"reason":"สั้นๆ"}

กฎ:
- ดึงทุกบรรทัดสินค้าที่เห็น (รวมของที่ไม่แน่ใจ)
- confidence ≥0.7 = วัตถุดิบชัด · <0.7 = ไม่แน่ใจ · บรรจุ (ถุง หลอด แก้ว ฝา) note="บรรจุ" confidence ต่ำ
- ห้ามแต่งชื่อที่มองไม่เห็น`;

  let extractedBills = 0;
  let created = 0;
  let aliased = 0;
  let skipped = 0;
  const createdNames = [];
  const allLineNames = new Set();

  for (const row of batch) {
    process.stdout.write(`\n→ ${row.id} ${row.desc.slice(0, 36)} … `);
    try {
      const imageParts = [];
      for (const ref of row.refs) {
        try {
          imageParts.push(await resolveImagePart(ref));
        } catch (e) {
          console.warn(`skip image ${ref}: ${e.message || e}`);
        }
      }
      if (!imageParts.length) {
        console.log("ไม่มีรูปใช้ได้");
        continue;
      }

      // ทีละรูปก่อน ถ้าได้น้อยค่อยรวม (ลด JSON ตัดกลาง)
      let billLines = [];
      for (const part of imageParts) {
        try {
          const parsed = await callGeminiJson({
            apiKey,
            model,
            imageParts: [part],
            systemText,
            userText: `อ่านรายการวัตถุดิบจากรูปใบเสร็จ · รายการบัญชี: ${row.desc}`,
          });
          const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
          for (const raw of rawLines) {
            const d = raw && typeof raw === "object" ? raw : {};
            const name = String(d.name || "").trim().slice(0, 120);
            if (!name) continue;
            if (billLines.some((l) => normalizeKey(l.name) === normalizeKey(name))) continue;
            const confidence = Number(d.confidence);
            billLines.push({
              name,
              packSize: Number(d.packSize) > 0 ? Number(d.packSize) : null,
              packUnit: String(d.packUnit || "").trim().slice(0, 20),
              price: Number(d.price) > 0 ? Number(d.price) : null,
              unitCost: Number(d.unitCost) > 0 ? Number(d.unitCost) : null,
              baseUnit: String(d.baseUnit || "ก.").trim().slice(0, 20) || "ก.",
              matchStockItemId: null,
              matchStockName: null,
              confidence: Number.isFinite(confidence)
                ? Math.min(1, Math.max(0, confidence))
                : 0,
              note: String(d.note || "").trim().slice(0, 160),
              costAppliedAt: null,
            });
            if (billLines.length >= 40) break;
          }
        } catch (e) {
          console.warn(` (รูป fail: ${String(e.message || e).slice(0, 60)})`);
        }
        if (billLines.length >= 40) break;
      }

      console.log(`AI ${billLines.length} บรรทัด`);
      if (!billLines.length) continue;
      extractedBills += 1;

      if (!dry) {
        await db.doc(`ledger/${row.id}`).set(
          { billLines, updatedAt: Date.now() },
          { merge: true },
        );
      }

      for (const line of billLines) {
        allLineNames.add(line.name);
        const note = String(line.note || "");
        if (PACKAGING_HINT.test(line.name) || /บรรจุ/i.test(note)) {
          skipped += 1;
          continue;
        }
        // ค่าบริการ / ขนส่ง / ภาษี — ไม่ใช่วัตถุดิบ
        if (
          /ค่าบริการ|ค่าขนส่ง|ค่าจัดส่ง|ค่าส่งของ|ค่าส่งสินค้า|ค่าธรรมเนียม|ค่าโอน|shipping|freight|delivery\s*fee|service\s*fee|^ภาษี|ภาษีมูลค่า|vat\s*\d|ส่วนลด|discount|มัดจำ/i.test(
            line.name,
          )
        ) {
          skipped += 1;
          continue;
        }
        // cogs → ถือเป็นวัตถุดิบ (ข้ามแค่บรรจุ + ค่าบริการ/ขนส่ง)
        const catalogName = suggestName(line.name) || line.name;
        const key = normalizeKey(catalogName);
        const billKey = normalizeKey(line.name);
        const hit = stockByKey.get(key) || stockByKey.get(billKey);
        if (hit) {
          if (
            catalogName !== hit.name &&
            !(hit.aliases || []).some((a) => normalizeKey(a) === billKey)
          ) {
            if (!dry) {
              await db.doc(`stock/${hit.id}`).set(
                {
                  aliases: admin.firestore.FieldValue.arrayUnion(line.name),
                  updatedAt: Date.now(),
                  updatedBy: "backfill-cogs-bills",
                },
                { merge: true },
              );
            }
            aliased += 1;
            hit.aliases = [...(hit.aliases || []), line.name];
            stockByKey.set(billKey, hit);
          } else {
            skipped += 1;
          }
          continue;
        }

        if (dry) {
          created += 1;
          createdNames.push(catalogName);
          stockByKey.set(key, { id: "dry", name: catalogName, aliases: [] });
          continue;
        }

        const ref = db.collection("stock").doc();
        await ref.set({
          name: catalogName,
          unit: (line.baseUnit || "ก.").trim() || "ก.",
          qty: 0,
          minQty: 0,
          alertEnabled: false,
          safetyStock: 0,
          includeInCount: false,
          aliases: catalogName === line.name ? [] : [line.name],
          note: "จากบิล · ประเภทต้นทุน · ยังไม่ยืนยันต้นทุน",
          icon: "bag",
          updatedAt: Date.now(),
          updatedBy: "backfill-cogs-bills",
        });
        created += 1;
        createdNames.push(catalogName);
        const entry = { id: ref.id, name: catalogName, aliases: catalogName === line.name ? [] : [line.name] };
        stockByKey.set(key, entry);
        if (billKey !== key) stockByKey.set(billKey, entry);
      }
    } catch (e) {
      console.log(`ERR ${e.message || e}`);
    }
  }

  console.log(
    "\n" +
      JSON.stringify(
        {
          extractedBills,
          uniqueLineNames: allLineNames.size,
          created,
          aliased,
          skipped,
          createdNames: [...new Set(createdNames)].sort((a, b) =>
            a.localeCompare(b, "th"),
          ),
        },
        null,
        2,
      ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
