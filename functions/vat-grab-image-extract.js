/**
 * อ่านแคปจอสรุปการเงิน Grab → 4 ช่องยอดเดลิเวอรี่ (พรีวิว)
 * Gemini vision · ตรวจว่าตรงเดือนที่เลือกหรือไม่
 * Key: GEMINI_API_KEY → meta/aiSettings.apiKey
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const REGION = "asia-southeast1";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();
const DEFAULT_MODEL = "gemini-2.5-flash";
const BOOTSTRAP_GEMINI_API_KEY = "";
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

const SYSTEM_PROMPT = `คุณอ่านแคปจอแอป GrabMerchant หน้า「การเงิน / สรุป」ของร้านเครื่องดื่มไทย
ดึงตัวเลขสรุปเดือนสำหรับตารางยอดเดลิเวอรี่ TellTea

ตอบเป็น JSON เท่านั้น:
{
  "monthKey":"YYYY-MM หรือว่าง",
  "periodLabel":"ช่วงวันที่บนจอ เช่น 01 - 31 Jul",
  "sales":ตัวเลขยอดขายสุทธิหรือ null,
  "transfer":ตัวเลขรายได้สุทธิ/รายได้หรือ null,
  "fee":ตัวเลขค่าคอมมิชชันแพลตฟอร์มเป็นค่าสัมบูรณ์หรือ null,
  "gpVat":ตัวเลขภาษีถ้าเห็นบนจอหรือ null,
  "orderCount":จำนวนคำสั่งซื้อหรือ null,
  "monthMatch":trueหรือfalse,
  "confidence":"high|medium|low",
  "notes":"สั้นๆ ภาษาไทย"
}

กฎแมป:
- sales = 「ยอดขายสุทธิ」(Net Sales) รวมทั้งเดือน
- transfer = 「รายได้」หรือ「รายได้สุทธิ」หลังหักค่าคอม
- fee = 「ค่าคอมมิชชันแพลตฟอร์ม」ใน「หักเงิน」— ใช้ค่าสัมบูรณ์ (อย่าติดลบ)
- ถ้าไม่เห็นภาษีแยกบนจอ → gpVat=null (ระบบจะคำนวณ ×7/107 เอง)
- monthKey = เดือนของช่วงวันที่บนจอ เป็น ค.ศ. เช่น ก.ค. 2026 → 2026-07
- monthMatch = true ถ้า monthKey ตรง selectedMonthKey ที่ผู้ใช้เลือก
- ห้ามแต่งตัวเลขที่มองไม่เห็น`;

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function absMoney(n) {
  return roundMoney(Math.abs(Number(n) || 0));
}

function gpVatFromFee(fee) {
  const f = Math.max(0, absMoney(fee));
  if (!(f > 0)) return 0;
  return roundMoney((f * 7) / 107);
}

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = asString(context.auth.token?.email, 120).toLowerCase();
  if (email && email === OWNER_EMAIL) return { actorId: email };
  const db = getFirestore();
  let staffId = email;
  if (!staffId) {
    const phone = asString(context.auth.token?.phone_number, 32);
    const digits = phone.startsWith("+") ? phone.slice(1) : phone;
    if (!digits) {
      throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
    }
    const phoneSnap = await db.collection("staffPhones").doc(digits).get();
    staffId = asString(phoneSnap.exists ? phoneSnap.get("staffId") : "", 120);
  }
  if (!staffId) {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  const staffSnap = await db.collection("staff").doc(staffId).get();
  if (!staffSnap.exists || staffSnap.get("role") !== "owner") {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  return { actorId: staffId };
}

async function loadAiSettings(db) {
  const snap = await db.doc("meta/aiSettings").get();
  const data = snap.exists ? snap.data() || {} : {};
  const enabled = data.enabled !== false;
  const model = String(data.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const apiKey =
    String(process.env.GEMINI_API_KEY || "").trim() ||
    String(data.apiKey || "").trim() ||
    BOOTSTRAP_GEMINI_API_KEY;
  return { enabled, model, apiKey };
}

function extractJsonObject(text) {
  const s = String(text || "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : s;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini ไม่ได้คืน JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function parseDataUrl(imageDataUrl) {
  const m = String(imageDataUrl || "").match(
    /^data:(image\/(?:jpeg|jpg|png|webp|heic|heif));base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (!m) return null;
  const mimeType = m[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const data = m[2].replace(/\s+/g, "");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) return null;
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `รูปใหญ่เกิน ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB`,
    );
  }
  return { mimeType, data, bytes: bytes.length };
}

async function callGeminiVisionJson({ apiKey, model, mimeType, data, userText }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data } },
          { text: userText },
        ],
      },
    ],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      String(json?.error?.message || `Gemini error (${res.status})`).slice(0, 240),
    );
  }
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return extractJsonObject(text);
}

exports.vatGrabImageExtract = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    await assertOwner(context);
    const db = getFirestore();
    const ai = await loadAiSettings(db);
    if (!ai.enabled || !ai.apiKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่ได้เปิด AI / ใส่ Gemini API key",
      );
    }

    const selectedMonthKey = asString(data?.monthKey, 7);
    const parsedImg = parseDataUrl(data?.imageDataUrl);
    if (!parsedImg) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "ต้องส่งรูปเป็น data URL (image/jpeg|png|webp)",
      );
    }

    try {
      const raw = await callGeminiVisionJson({
        apiKey: ai.apiKey,
        model: ai.model,
        mimeType: parsedImg.mimeType,
        data: parsedImg.data,
        userText: `อ่านแคปจอ GrabMerchant สรุปการเงินนี้
selectedMonthKey ที่เจ้าของเลือก = ${selectedMonthKey || "(ไม่ระบุ)"}
ดึง JSON ตามระบบ`,
      });

      const sales = absMoney(raw.sales);
      const transfer = absMoney(raw.transfer);
      const fee = absMoney(raw.fee);
      let gpVat = raw.gpVat == null || raw.gpVat === "" ? null : absMoney(raw.gpVat);
      if (!(gpVat > 0) && fee > 0) gpVat = gpVatFromFee(fee);

      let monthKey = asString(raw.monthKey, 7);
      if (!/^\d{4}-\d{2}$/.test(monthKey)) monthKey = "";
      const monthMatch =
        Boolean(raw.monthMatch) ||
        (selectedMonthKey && monthKey && selectedMonthKey === monthKey);

      const warnings = [];
      if (selectedMonthKey && monthKey && selectedMonthKey !== monthKey) {
        warnings.push(
          `เดือนในรูป ${monthKey} ≠ เดือนที่เลือก ${selectedMonthKey}`,
        );
      }
      if (!(sales > 0) || !(transfer > 0)) {
        warnings.push("อ่านยอดขาย/รายได้ไม่ครบ");
      }
      if (fee > 0 && Math.abs(sales - fee - transfer) > 1) {
        warnings.push(
          `ตรวจสมการ: ขาย − คชจ. ≈ โอน (ต่าง ${roundMoney(sales - fee - transfer)})`,
        );
      }

      return {
        ok: sales > 0 || transfer > 0,
        channel: "grab",
        kind: "grab-finance-screenshot",
        selectedMonthKey,
        monthKey,
        periodLabel: asString(raw.periodLabel, 80),
        sales,
        transfer,
        fee,
        gpVat: gpVat || 0,
        orderCount:
          raw.orderCount == null || raw.orderCount === ""
            ? null
            : Number(raw.orderCount) || null,
        monthMatch: Boolean(monthMatch),
        confidence: asString(raw.confidence, 16) || "medium",
        notes: asString(raw.notes, 200),
        warnings,
        model: ai.model,
      };
    } catch (e) {
      if (e instanceof functions.https.HttpsError) throw e;
      throw new functions.https.HttpsError(
        "internal",
        asString(e?.message || String(e), 300),
      );
    }
  });
