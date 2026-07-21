/**
 * Ledger type classification via Gemini (server-side only).
 * API key: process.env.GEMINI_API_KEY → meta/aiSettings.apiKey → bootstrap fallback.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const ALLOWED_TYPES = new Set(["cogs", "sga", "asset", "อื่นๆ"]);
const DEFAULT_MODEL = "gemini-2.5-flash";

/** Bootstrap only via env / owner AI settings — never commit keys. */
const BOOTSTRAP_GEMINI_API_KEY = "";

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยจัดประเภทบัญชีสำหรับร้านเครื่องดื่ม/เบเกอรี่ในไทย
เลือกประเภทเงินออกได้เพียงค่าใดค่าหนึ่ง:
- cogs = ต้นทุนขาย (วัตถุดิบ ส่วนผสม แพ็กเกจที่ขายไปกับสินค้า ของใช้ทำเครื่องดื่ม)
- sga = ค่าใช้จ่ายดำเนินงาน (ค่าแรง โบนัส ค่าไฟ ค่าน้ำ ค่าเน็ต ค่าเช่า ค่าขนส่ง ซ่อมบำรุง ล้างแอร์ ของใช้ทำความสะอาด ค่าทดลองงาน DIY)
- asset = สินทรัพย์ถาวร (ซื้อเครื่องจักร อุปกรณ์ถาวร ตู้ แอร์ ใหม่ที่ใช้งานได้หลายปี — ไม่ใช่ค่าซ่อม)
- อื่นๆ = ไม่ชัดหรือไม่เข้ากลุ่มด้านบน

กฎสำคัญ:
- "ส่งเครื่องซ่อม" / ค่าซ่อม / ซ่อมบำรุง → sga ไม่ใช่ asset
- ซื้อเครื่องใหม่/อุปกรณ์ถาวร → asset
- ซื้อนม ชา น้ำตาล แก้ว หลอด น้ำแข็ง → cogs
- ค่าแรง พนักงาน โบนัส → sga

ตอบเป็น JSON เท่านั้น ในรูป:
{"type":"cogs|sga|asset|อื่นๆ","reason":"เหตุผลสั้นๆ ภาษาไทยไม่เกิน 40 ตัวอักษร"}`;

function normalizeType(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase();
  if (t === "cosg") return "cogs";
  if (t === "assets") return "asset";
  if (t === "other" || t === "others") return "อื่นๆ";
  if (ALLOWED_TYPES.has(t)) return t;
  if (t === "อื่นๆ" || String(raw || "").trim() === "อื่นๆ") return "อื่นๆ";
  return null;
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
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

async function callGemini({ apiKey, model, description }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `ชื่อรายการ: ${description}` }],
        },
      ],
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.1,
        // gemini-2.5* uses thinking tokens — keep headroom for JSON answer
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
  const type = normalizeType(parsed?.type);
  if (!type) {
    throw new Error("AI ตอบประเภทไม่ถูกต้อง");
  }
  const reason = String(parsed?.reason || "").trim().slice(0, 80);
  return { type, reason };
}

function requireStaff(context) {
  if (!context?.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
}

exports.classifyLedgerType = functions
  .region("asia-southeast1")
  .https.onCall(async (data, context) => {
    requireStaff(context);

    const description = String(data?.description || "").trim();
    if (!description) {
      throw new functions.https.HttpsError("invalid-argument", "ต้องใส่ชื่อรายการ");
    }
    if (description.length > 200) {
      throw new functions.https.HttpsError("invalid-argument", "ชื่อรายการยาวเกินไป");
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

    try {
      const result = await callGemini({
        apiKey: settings.apiKey,
        model,
        description,
      });
      return {
        type: result.type,
        reason: result.reason,
        model,
        source: "ai",
      };
    } catch (err) {
      console.error("classifyLedgerType failed", err?.message || err);
      throw new functions.https.HttpsError(
        "internal",
        `จัดประเภทด้วย AI ไม่สำเร็จ — ${String(err?.message || err).slice(0, 120)}`,
      );
    }
  });

exports.ALLOWED_TYPES = ALLOWED_TYPES;
exports.normalizeType = normalizeType;
exports.extractJsonObject = extractJsonObject;
exports.DEFAULT_MODEL = DEFAULT_MODEL;
exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
