/**
 * Owner-books receipt OCR / autofill via Gemini (multimodal).
 * Resolves evp: refs from evidencePhotos, data URLs, or Firebase Storage HTTPS.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  ALLOWED_TYPES,
  normalizeType,
  extractJsonObject,
  isAllowedImageUrl,
  DEFAULT_MODEL,
  DEFAULT_BUSINESS_CONTEXT,
  formatBusinessProfile,
  MAX_IMAGES,
} = require("./classify-ledger");

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const BOOTSTRAP_GEMINI_API_KEY = "";

const EXTRACT_SYSTEM_PROMPT = `คุณเป็นผู้ช่วยอ่านใบเสร็จ/หลักฐานการจ่ายเงินสำหรับร้านเครื่องดื่ม/เบเกอรี่ในไทย
อ่านจากรูปแล้วดึงข้อมูลสำหรับบันทึกบัญชีเงินออก + ภาษีซื้อ (VAT)

ตอบเป็น JSON เท่านั้น ในรูป:
{"date":"YYYY-MM-DD หรือว่าง","description":"ชื่อรายการสั้นๆ ภาษาไทย","amountOut":จำนวนเงินเป็นตัวเลขหรือ null,"type":"cogs|sga|asset|อื่นๆ","note":"หมายเหตุสั้นๆ หรือว่าง","reason":"เหตุผลสั้นๆ ภาษาไทยไม่เกิน 40 ตัวอักษร","hasVat":trueหรือfalse,"vatInput":จำนวนภาษีมูลค่าเพิ่มเป็นตัวเลขหรือ null,"vatBase":มูลค่าก่อนภาษีหรือ null,"vatInvoiceNo":"เลขที่ใบกำกับหรือว่าง","vatSeenOnBill":trueหรือfalse,"vatReason":"สั้นๆ ว่าเห็น VAT จากตรงไหน หรือทำไมไม่มี"}

กฎ:
- date = วันที่บนใบเสร็จ (ไม่ใช่วันที่อัปโหลด) ถ้าไม่ชัดให้ "" 
- description = สรุปสิ่งที่ซื้อ/จ่าย สั้น ชัด (เช่น "นมสดแม็คโคร" "ท็อปเวิลด์" "ท็อปส์" "ค่าไฟ")
- amountOut = ยอดรวมที่จ่ายจริง (ตัวเลข ไม่มี comma) ถ้าไม่ชัดให้ null
- type ตามกฎบัญชี: cogs=วัตถุดิบ/บรรจุภัณฑ์/ค่าขนส่งวัตถุดิบ · sga=ค่าแรง/ค่าไฟ/ค่าเช่า/ซ่อม · asset=เครื่องจักร/อุปกรณ์ถาวร · อื่นๆ=ไม่ชัด
- ถ้ามีหลายรายการในใบเสร็จ ให้สรุปเป็นรายการหลักหนึ่งรายการ + ยอดรวม
- **VAT (สำคัญ — อ่านท้ายบิลให้ละเอียด):**
  - โฟกัสบล็อกสรุปท้ายใบเสร็จ ใกล้ TOTAL / NET / ยอดสุทธิ / มูลค่าสินค้า / ส่วนลด
  - ค้นหาป้ายเหล่านี้แม้ตัวพิมพ์เล็ก จาง หรือเป็นใบเสร็จความร้อนยาว:
    "ภาษีมูลค่าเพิ่ม" · "ภาษีมูลค่าเพิ่ม 7%" · "VAT" · "V.A.T" · "VAT 7%" · "ภาษี 7%" · "TAX" · "รวมภาษีมูลค่าเพิ่ม" · "VAT AMOUNT"
  - ห้างค้าส่ง/ซูเปอร์มาร์เก็ตไทย (ท็อปเวิลด์ · ท็อปส์ · ท็อปแวลู · แม็คโคร · บิ๊กซี · โลตัส · โฮมโปร) มักออกใบกำกับภาษีอย่างย่อ — VAT อยู่ท้ายบิลแยกจากยอดรวม
  - ถ้าเห็นคำว่า "ใบกำกับภาษี" / "ใบกำกับภาษีอย่างย่อ" / "Tax Invoice" ให้หาบรรทัดยอดภาษีด้วย
  - vatInput = ตัวเลขยอดภาษีที่พิมพ์ข้างป้ายด้านบน (ไม่ใช่ยอดรวม ไม่ใช่จำนวนชิ้น)
  - vatBase = มูลค่าสินค้า/บริการก่อน VAT ถ้าเห็นบนบิล (เช่น "มูลค่าสินค้า" "AMOUNT before VAT")
  - hasVat = true และ vatSeenOnBill = true เมื่ออ่านตัวเลขภาษีจากบิลได้
  - **ห้ามคำนวณ VAT จากยอดรวม×7/107 เอง** — ถ้ามองไม่เห็นตัวเลขภาษีจริง ให้ hasVat=false, vatInput=null
  - ถ้ายอดภาษีอ่านได้แต่ไม่ชัดทุกหลัก ให้ใส่ค่าที่อ่านได้พร้อม vatReason บอกความมั่นใจ
  - vatInvoiceNo = เลขที่ใบกำกับ/เลขที่เอกสารถ้าเห็น
- ห้ามแต่งข้อมูลที่มองไม่เห็นในรูป`;

const VAT_RETRY_SYSTEM_PROMPT = `คุณเป็นผู้ช่วย OCR ใบเสร็จไทย — รอบนี้โฟกัสเฉพาะภาษีมูลค่าเพิ่ม (VAT)
อ่านท้ายบิล/บล็อกสรุปอย่างละเอียด แม้ตัวอักษรเล็ก จาง หรือใบเสร็จยาวจากท็อปเวิลด์ ท็อปส์ แม็คโคร บิ๊กซี โลตัส

ตอบเป็น JSON เท่านั้น:
{"hasVat":trueหรือfalse,"vatInput":จำนวนภาษีเป็นตัวเลขหรือ null,"vatBase":มูลค่าก่อนภาษีหรือ null,"vatInvoiceNo":"เลขที่ใบกำกับหรือว่าง","vatSeenOnBill":trueหรือfalse,"vatReason":"สั้นๆ"}

กฎ:
- หาป้าย: ภาษีมูลค่าเพิ่ม · VAT · VAT 7% · ภาษี 7% · V.A.T · TAX · รวมภาษีมูลค่าเพิ่ม
- vatInput = ตัวเลขยอดภาษีที่พิมพ์บนบิลเท่านั้น
- ห้ามคำนวณจากยอดรวม×7/107
- ถ้าไม่เห็นตัวเลขภาษีจริง → hasVat=false, vatInput=null`;

function buildExtractSystemPrompt(businessContext) {
  const ctx = String(businessContext || "").trim() || DEFAULT_BUSINESS_CONTEXT;
  return `${EXTRACT_SYSTEM_PROMPT}\n\n${ctx}`;
}

function requireStaff(context) {
  if (!context?.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
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

async function loadBusinessContext(db) {
  const snap = await db.doc("meta/businessProfile").get();
  if (!snap.exists) return DEFAULT_BUSINESS_CONTEXT;
  const formatted = formatBusinessProfile(snap.data());
  return formatted.includes("ประเภทกิจการ: -") && formatted.includes("สินค้า/บริการ: -")
    ? DEFAULT_BUSINESS_CONTEXT
    : formatted || DEFAULT_BUSINESS_CONTEXT;
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
  if (path.includes(".gif")) return "image/gif";
  return "image/jpeg";
}

function partFromDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) throw new Error("data URL ไม่ถูกต้อง");
  const mimeType = m[1].toLowerCase();
  const data = m[2];
  const approxBytes = Math.floor((data.length * 3) / 4);
  if (!data || approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("รูปใหญ่เกินไป");
  }
  return { inlineData: { mimeType, data } };
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
    const dataUrl = String(snap.data()?.dataUrl || "");
    return partFromDataUrl(dataUrl);
  }

  if (raw.startsWith("data:image/")) {
    return partFromDataUrl(raw);
  }

  if (isAllowedImageUrl(raw)) {
    return fetchImagePart(raw);
  }

  throw new Error("รองรับเฉพาะรูปหลักฐานหรือลิงก์ Storage");
}

function normalizeDate(raw) {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const t = Date.parse(`${s}T12:00:00`);
  if (Number.isNaN(t)) return "";
  return s;
}

function normalizeAmount(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 100) / 100;
  }
  const s = String(raw)
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "")
    .trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizeVatFields(parsed) {
  const vatInput = normalizeAmount(parsed?.vatInput);
  const vatBase = normalizeAmount(parsed?.vatBase);
  const hasVatFlag =
    parsed?.hasVat === true ||
    parsed?.hasVat === "true" ||
    (vatInput != null && vatInput > 0);
  const vatSeenOnBill =
    parsed?.vatSeenOnBill === true ||
    parsed?.vatSeenOnBill === "true" ||
    (hasVatFlag && vatInput != null);
  return {
    hasVat: Boolean(hasVatFlag && vatInput != null),
    vatInput,
    vatBase,
    vatInvoiceNo: String(parsed?.vatInvoiceNo || "")
      .trim()
      .slice(0, 80),
    vatSeenOnBill: Boolean(vatSeenOnBill && vatInput != null),
    vatReason: String(parsed?.vatReason || "")
      .trim()
      .slice(0, 80),
  };
}

async function postGeminiGenerate({ apiKey, model, imageParts, systemText, userText, richVision }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const generationConfig = {
    temperature: 0.1,
    // Leave room after thinking tokens; OCR needs a complete JSON object.
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
  };
  if (richVision) {
    // Prefer fine text on thermal receipts (Top World / Tops / Makro).
    generationConfig.mediaResolution = "MEDIA_RESOLUTION_HIGH";
    // Keep thinking small so VAT fields are not truncated.
    generationConfig.thinkingConfig = { thinkingBudget: 256 };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [...imageParts, { text: userText }] }],
      systemInstruction: {
        parts: [{ text: systemText }],
      },
      generationConfig,
    }),
  });

  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function callGeminiJson({
  apiKey,
  model,
  imageParts,
  systemText,
  userText,
}) {
  let { res, body } = await postGeminiGenerate({
    apiKey,
    model,
    imageParts,
    systemText,
    userText,
    richVision: true,
  });

  if (!res.ok) {
    const msg = String(
      body?.error?.message || body?.error?.status || `Gemini HTTP ${res.status}`,
    );
    // Older / alternate models may reject mediaResolution or thinkingConfig.
    if (/mediaResolution|thinkingConfig|Unknown name|Invalid JSON/i.test(msg)) {
      ({ res, body } = await postGeminiGenerate({
        apiKey,
        model,
        imageParts,
        systemText,
        userText,
        richVision: false,
      }));
    } else {
      throw new Error(msg.slice(0, 180));
    }
  }

  if (!res.ok) {
    const msg =
      body?.error?.message || body?.error?.status || `Gemini HTTP ${res.status}`;
    throw new Error(String(msg).slice(0, 180));
  }

  const text =
    body?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI ตอบรูปแบบไม่ถูกต้อง");
  }
  return parsed;
}

async function callGeminiExtract({ apiKey, model, imageParts, businessContext }) {
  const parsed = await callGeminiJson({
    apiKey,
    model,
    imageParts,
    systemText: buildExtractSystemPrompt(businessContext),
    userText: `อ่านใบเสร็จ/หลักฐานในรูป ${imageParts.length} รูป แล้วดึงข้อมูลบัญชีเงินออกตามรูปแบบ JSON
สำคัญ: สแกนท้ายบิลหาบรรทัดภาษีมูลค่าเพิ่ม/VAT ให้ละเอียด (โดยเฉพาะท็อปเวิลด์ ท็อปส์ แม็คโคร)`,
  });

  const type = normalizeType(parsed.type) || "อื่นๆ";
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("AI ตอบประเภทไม่ถูกต้อง");
  }

  let vat = normalizeVatFields(parsed);
  const amountOut = normalizeAmount(parsed.amountOut);

  // Second pass: amount found but VAT missed — common on long Top World slips.
  if ((!vat.hasVat || vat.vatInput == null) && amountOut != null) {
    try {
      const vatParsed = await callGeminiJson({
        apiKey,
        model,
        imageParts,
        systemText: VAT_RETRY_SYSTEM_PROMPT,
        userText: `รอบสอง: โฟกัสเฉพาะยอดภาษีมูลค่าเพิ่มบนใบเสร็จ ${imageParts.length} รูป
ดูท้ายบิลใกล้ TOTAL/NET/ยอดสุทธิ — หากร้านท็อปเวิลด์/ท็อปส์/แม็คโคร ให้หา VAT 7% เป็นพิเศษ
ยอดจ่ายที่อ่านได้ก่อนหน้า ≈ ${amountOut} (ใช้อ้างอิงตำแหน่งท้ายบิลเท่านั้น ห้ามเอาไปคำนวณ VAT)`,
      });
      const retryVat = normalizeVatFields(vatParsed);
      if (retryVat.hasVat && retryVat.vatInput != null) {
        vat = retryVat;
      } else if (retryVat.vatReason && !vat.vatReason) {
        vat = { ...vat, vatReason: retryVat.vatReason };
      }
    } catch (err) {
      console.warn("vat retry skip", err?.message || err);
    }
  }

  return {
    date: normalizeDate(parsed.date),
    description: String(parsed.description || "")
      .trim()
      .slice(0, 120),
    amountOut,
    type,
    note: String(parsed.note || "")
      .trim()
      .slice(0, 120),
    reason: String(parsed.reason || "")
      .trim()
      .slice(0, 80),
    ...vat,
  };
}

exports.extractOwnerBookFromReceipt = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    requireStaff(context);

    const rawRefs = Array.isArray(data?.imageRefs)
      ? data.imageRefs
      : Array.isArray(data?.imageUrls)
        ? data.imageUrls
        : [];
    const imageRefs = rawRefs
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, MAX_IMAGES);

    if (!imageRefs.length) {
      throw new functions.https.HttpsError("invalid-argument", "ต้องมีรูปอย่างน้อย 1 รูป");
    }

    const db = getFirestore();
    const settings = await loadAiSettings(db);
    if (!settings.enabled) {
      throw new functions.https.HttpsError("failed-precondition", "ปิดการจัดประเภทด้วย AI อยู่");
    }
    if (!settings.apiKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่มี API key — ตั้งค่าในแผง AI ของสมุดบัญชี",
      );
    }

    const modelOverride = String(data?.model || "").trim();
    const model = modelOverride || settings.model;
    const businessContext = await loadBusinessContext(db);

    const imageParts = [];
    for (const ref of imageRefs) {
      if (imageParts.length >= MAX_IMAGES) break;
      try {
        imageParts.push(await resolveImagePart(db, ref));
      } catch (err) {
        console.warn("skip image for extract", err?.message || err);
      }
    }
    if (!imageParts.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "โหลดรูปไม่สำเร็จ — ลองถ่าย/แนบใหม่",
      );
    }

    try {
      const result = await callGeminiExtract({
        apiKey: settings.apiKey,
        model,
        imageParts,
        businessContext,
      });
      return {
        ...result,
        model,
        source: "ai",
        usedImages: imageParts.length,
      };
    } catch (err) {
      console.error("extractOwnerBookFromReceipt failed", err?.message || err);
      throw new functions.https.HttpsError(
        "internal",
        `อ่านใบเสร็จด้วย AI ไม่สำเร็จ — ${String(err?.message || err).slice(0, 120)}`,
      );
    }
  });
