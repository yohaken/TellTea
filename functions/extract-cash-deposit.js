/**
 * Cash-deposit slip OCR via Gemini (multimodal).
 * Modes:
 *  - bank: K+/bank transfer e-slip → bankAmount, transferFee, bankRef, transferDate
 *  - day:  POS daily/shift cash summary → cashAmount, drawerCloseAmount, date
 * Resolves evp: refs from evidencePhotos (same as extract-owner-book).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  extractJsonObject,
  isAllowedImageUrl,
  DEFAULT_MODEL,
  DEFAULT_BUSINESS_CONTEXT,
  formatBusinessProfile,
  MAX_IMAGES,
} = require("./classify-ledger");

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const BOOTSTRAP_GEMINI_API_KEY = "";

const BANK_SYSTEM_PROMPT = `คุณเป็นผู้ช่วยอ่านสลิปโอนเงินเข้าบัญชีร้าน (เช่น K+ / PromptPay / ธนาคารไทย)
อ่านจากรูปของสลิปโอนหนึ่งใบ (อาจมี 1–2 รูปของใบเดียวกัน) แล้วดึงยอดของใบนั้นเท่านั้น

ตอบเป็น JSON เท่านั้น:
{"transferDate":"YYYY-MM-DD หรือว่าง","bankAmount":จำนวนเงินที่โอนเข้าหรือ null,"transferFee":ค่าธรรมเนียมโอนเป็นตัวเลขหรือ 0,"bankRef":"เลขอ้างอิง/Transaction ID หรือว่าง","reason":"เหตุผลสั้นๆ ภาษาไทยไม่เกิน 40 ตัวอักษร"}

กฎ:
- นี่คือสลิปโอนหนึ่งรายการ — อย่ารวมยอดจากสลิปอื่น
- bankAmount = ยอดเงินที่เข้าบัญชีผู้รับในใบนี้ (ไม่รวม fee ถ้าแยก) ตัวเลขไม่มี comma
- transferFee = ค่าธรรมเนียมโอนของใบนี้ ถ้าสลิปแสดง 0 หรือไม่มีให้เป็น 0
- ถ้ามี 2 รูปของรายการโอนเดียวกัน ให้ถือเป็นใบเดียว (อย่าบวกยอดซ้ำ)
- transferDate = วันที่บนสลิปโอน
- ห้ามแต่งข้อมูลที่มองไม่เห็นในรูป`;

const DAY_SYSTEM_PROMPT = `คุณเป็นผู้ช่วยอ่านสลิปสรุปยอดขาย POS (เช่น FoodStory W POS / nPOS / mPOS) ของร้านเครื่องดื่มไทย
เป้าหมายคือดึงยอดขายเงินสดที่พนักงานต้องนำส่งเข้าบัญชีเจ้าของ — ไม่ใช่ยอดขายรวม และไม่ใช่ยอดลิ้นชัก

ตอบเป็น JSON เท่านั้น:
{"date":"YYYY-MM-DD หรือว่าง","cashAmount":ยอดขายเงินสดหรือ null,"drawerCloseAmount":null,"slipKind":"daily|shift|unknown","shiftLabel":"เช้า|เย็น|ว่าง","reason":"เหตุผลสั้นๆ ภาษาไทยไม่เกิน 40 ตัวอักษร"}

กฎ:
- cashAmount = ยอดจากส่วน "ยอดขายตามการชำระเงิน" / Payment → แถว "เงินสด" / Cash เท่านั้น (ตัวเลขไม่มี comma)
- ห้ามใช้: ยอดขายสุทธิ, Gross Total, โอนเงิน, LINE Pay, PromptPay, รวมทุกช่องทาง
- ห้ามใช้: เงินสดเริ่มต้น, Expected Cash, Actual Cash, จำนวนเงินที่ควรมี, จำนวนเงินจริงในลิ้นชัก, ส่วนต่าง — ส่ง drawerCloseAmount เป็น null เสมอ
- date = วันที่ของรอบขาย/วันที่ปิดรอบบนสลิป (ถ้ามีลายมือเขียนวัน ให้ใช้วันนั้น) แปลง พ.ศ.→ค.ศ. เป็น YYYY-MM-DD
- slipKind = daily ถ้าเป็นสรุปรายวัน · shift ถ้าเป็นสลิปกะ · unknown ถ้าไม่แน่ใจ
- ห้ามแต่งข้อมูลที่มองไม่เห็นในรูป`;

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

function normalizeAmount(raw, { allowZero = false } = {}) {
  if (raw == null || raw === "") return allowZero ? 0 : null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw < 0) return allowZero ? 0 : null;
    if (raw === 0) return allowZero ? 0 : null;
    return Math.round(raw * 100) / 100;
  }
  const s = String(raw)
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "")
    .trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return allowZero ? 0 : null;
  if (n === 0) return allowZero ? 0 : null;
  return Math.round(n * 100) / 100;
}

function normalizeSlipKind(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "daily" || s === "shift" || s === "unknown") return s;
  return "unknown";
}

async function callGeminiCashExtract({ apiKey, model, imageParts, businessContext, mode }) {
  const isBank = mode === "bank";
  const system = `${isBank ? BANK_SYSTEM_PROMPT : DAY_SYSTEM_PROMPT}\n\n${businessContext || DEFAULT_BUSINESS_CONTEXT}`;
  const userText = isBank
    ? `อ่านสลิปโอนเงินเข้าบัญชีร้านจากรูป ${imageParts.length} รูป แล้วดึง JSON ตามรูปแบบ`
    : `อ่านสลิปสรุป POS/เงินสดจากรูป ${imageParts.length} รูป แล้วดึง JSON ตามรูปแบบ`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [...imageParts, { text: userText }] }],
      systemInstruction: { parts: [{ text: system }] },
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

  const reason = String(parsed.reason || "")
    .trim()
    .slice(0, 80);

  if (isBank) {
    return {
      mode: "bank",
      transferDate: normalizeDate(parsed.transferDate || parsed.date),
      bankAmount: normalizeAmount(parsed.bankAmount),
      transferFee: normalizeAmount(parsed.transferFee, { allowZero: true }) ?? 0,
      bankRef: String(parsed.bankRef || "")
        .trim()
        .slice(0, 80),
      reason,
    };
  }

  return {
    mode: "day",
    date: normalizeDate(parsed.date),
    cashAmount: normalizeAmount(parsed.cashAmount),
    drawerCloseAmount: normalizeAmount(parsed.drawerCloseAmount),
    slipKind: normalizeSlipKind(parsed.slipKind),
    shiftLabel: String(parsed.shiftLabel || "")
      .trim()
      .slice(0, 40),
    reason,
  };
}

exports.extractCashDepositSlip = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 90, memory: "512MB" })
  .https.onCall(async (data, context) => {
    requireStaff(context);

    const mode = String(data?.mode || "").trim() === "bank" ? "bank" : "day";
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
      throw new functions.https.HttpsError("failed-precondition", "ปิด AI อยู่ — เปิดในแผงตั้งค่า AI ของบัญชี");
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
        console.warn("skip image for cash-deposit extract", err?.message || err);
      }
    }
    if (!imageParts.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "โหลดรูปไม่สำเร็จ — ลองถ่าย/แนบใหม่",
      );
    }

    try {
      const result = await callGeminiCashExtract({
        apiKey: settings.apiKey,
        model,
        imageParts,
        businessContext,
        mode,
      });
      return {
        ...result,
        model,
        source: "ai",
        usedImages: imageParts.length,
      };
    } catch (err) {
      console.error("extractCashDepositSlip failed", err?.message || err);
      throw new functions.https.HttpsError(
        "internal",
        `อ่านสลิปด้วย AI ไม่สำเร็จ — ${String(err?.message || err).slice(0, 120)}`,
      );
    }
  });
