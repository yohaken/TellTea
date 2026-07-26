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
อ่านจากรูปแล้วดึงข้อมูลสำหรับบันทึกบัญชีเงินออก

ตอบเป็น JSON เท่านั้น ในรูป:
{"date":"YYYY-MM-DD หรือว่าง","description":"ชื่อรายการสั้นๆ ภาษาไทย","amountOut":จำนวนเงินเป็นตัวเลขหรือ null,"type":"cogs|sga|asset|อื่นๆ","note":"หมายเหตุสั้นๆ หรือว่าง","reason":"เหตุผลสั้นๆ ภาษาไทยไม่เกิน 40 ตัวอักษร"}

กฎ:
- date = วันที่บนใบเสร็จ (ไม่ใช่วันที่อัปโหลด) ถ้าไม่ชัดให้ "" 
- description = สรุปสิ่งที่ซื้อ/จ่าย สั้น ชัด (เช่น "นมสด" "ค่าไฟ" "แก้วพลาสติก")
- amountOut = ยอดรวมที่จ่ายจริง (ตัวเลข ไม่มี comma) ถ้าไม่ชัดให้ null
- type ตามกฎบัญชี: cogs=วัตถุดิบ/บรรจุภัณฑ์/ค่าขนส่งวัตถุดิบ · sga=ค่าแรง/ค่าไฟ/ค่าเช่า/ซ่อม · asset=เครื่องจักร/อุปกรณ์ถาวร · อื่นๆ=ไม่ชัด
- ถ้ามีหลายรายการในใบเสร็จ ให้สรุปเป็นรายการหลักหนึ่งรายการ + ยอดรวม
- ห้ามแต่งข้อมูลที่มองไม่เห็นในรูป`;

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

async function callGeminiExtract({ apiKey, model, imageParts, businessContext }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [
    ...imageParts,
    {
      text: `อ่านใบเสร็จ/หลักฐานในรูป ${imageParts.length} รูป แล้วดึงข้อมูลบัญชีเงินออกตามรูปแบบ JSON`,
    },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      systemInstruction: {
        parts: [{ text: buildExtractSystemPrompt(businessContext) }],
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),
  });

  const body = await res.json().catch(() => ({}));
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

  const type = normalizeType(parsed.type) || "อื่นๆ";
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("AI ตอบประเภทไม่ถูกต้อง");
  }

  return {
    date: normalizeDate(parsed.date),
    description: String(parsed.description || "")
      .trim()
      .slice(0, 120),
    amountOut: normalizeAmount(parsed.amountOut),
    type,
    note: String(parsed.note || "")
      .trim()
      .slice(0, 120),
    reason: String(parsed.reason || "")
      .trim()
      .slice(0, 80),
  };
}

exports.extractOwnerBookFromReceipt = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 90, memory: "512MB" })
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
