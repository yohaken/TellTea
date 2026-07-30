/**
 * Owner-books / ledger receipt OCR via Gemini (multimodal).
 * Resolves evp: refs from evidencePhotos, data URLs, or Firebase Storage HTTPS.
 *
 * Multi-photo: staff often attach bank transfer slip + tax invoice together.
 * Each image is read separately; VAT is taken only from the tax invoice.
 * Never invent VAT via ×7/107 (mixed VAT / non-VAT lines on Top World etc.).
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
const { mergeExtractResults, normalizeDocKind } = require("./merge-receipt-extract");

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const BOOTSTRAP_GEMINI_API_KEY = "";

const EXTRACT_SYSTEM_PROMPT = `คุณเป็นผู้ช่วยอ่านใบเสร็จ/หลักฐานการจ่ายเงินสำหรับร้านเครื่องดื่ม/เบเกอรี่ในไทย
อ่านจากรูปเดียวแล้วดึงข้อมูลสำหรับบันทึกบัญชีเงินออก + ภาษีซื้อ (VAT)

ตอบเป็น JSON เท่านั้น ในรูป:
{"docKind":"tax_invoice|bank_slip|other","date":"YYYY-MM-DD หรือว่าง","description":"ชื่อรายการสั้นๆ ภาษาไทย","amountOut":จำนวนเงินเป็นตัวเลขหรือ null,"type":"cogs|sga|asset|อื่นๆ","note":"หมายเหตุสั้นๆ หรือว่าง","reason":"เหตุผลสั้นๆ ภาษาไทยไม่เกิน 40 ตัวอักษร","hasVat":trueหรือfalse,"vatInput":จำนวนภาษีมูลค่าเพิ่มเป็นตัวเลขหรือ null,"vatBase":มูลค่าก่อนภาษีหรือ null,"vatInvoiceNo":"เลขที่ใบกำกับหรือว่าง","vatSeenOnBill":trueหรือfalse,"vatReason":"สั้นๆ ว่าเห็น VAT จากตรงไหน หรือทำไมไม่มี"}

กฎ:
- docKind:
  - tax_invoice = ใบเสร็จรับเงิน / ใบกำกับภาษี / ใบกำกับอย่างย่อ / บิลห้าง (ท็อปเวิลด์ ท็อปส์ แม็คโคร ฯลฯ)
  - bank_slip = สลิปโอนเงิน / PromptPay / แอปธนาคาร / หลักฐานโอน — **ไม่มี VAT บนสลิปนี้**
  - other = อื่นๆ
- ถ้า docKind=bank_slip → hasVat=false, vatInput=null, vatBase=null เสมอ (อย่าเดา VAT จากยอดโอน)
- date = วันที่บนเอกสารเป็น **ค.ศ. YYYY-MM-DD เท่านั้น** (เช่น 2025-07-22) — ถ้าบิลเป็นพ.ศ. ให้ลบ 543 ก่อน ห้ามส่งปีพ.ศ. ถ้าไม่ชัดให้ ""
- description = สรุปสั้น ชัด (เช่น "ท็อปเวิลด์" "นมสดแม็คโคร" "โอนค่าของ")
- amountOut = ยอดบนเอกสารนั้น (ตัวเลข ไม่มี comma) ถ้าไม่ชัดให้ null
- type: cogs=วัตถุดิบ/บรรจุภัณฑ์ · sga=ค่าแรง/ค่าไฟ/ค่าเช่า/ซ่อม · asset=เครื่องจักร · อื่นๆ=ไม่ชัด
- **VAT — อ่านตัวเลขที่พิมพ์บนใบกำกับเท่านั้น ห้ามคำนวณ ×7/107 จากยอดรวม**
  (บางรายการสินค้าไม่มี VAT การคูณยอดรวมจะผิด)
  - โฟกัสท้ายบิลใต้ยอดรวมตัวหนา: หา "ภาษีมูลค่าเพิ่ม" / "ภาษีมูลค่าเพิ่ม 7%" / "VAT" / "VAT 7%"
  - ท็อปเวิลด์มักมีคู่ "ฐานภาษี 7%" และ "ภาษีมูลค่าเพิ่ม 7%" ใต้ยอดรวม — อ่านตัวเลขขวาสุดของแต่ละบรรทัด
  - ตัว "V" ท้ายรายการสินค้า = สินค้าเสีย VAT ไม่ใช่ยอดภาษี
  - vatInput = ตัวเลขข้างป้ายภาษีมูลค่าเพิ่มเท่านั้น
  - vatBase = ตัวเลขข้างป้ายฐานภาษี ถ้าเห็น
  - ถ้าไม่เห็นบรรทัดภาษีชัด → hasVat=false, vatInput=null
- ห้ามแต่งข้อมูลที่มองไม่เห็นในรูป`;

const VAT_RETRY_SYSTEM_PROMPT = `คุณเป็นผู้ช่วย OCR ใบเสร็จไทย — โฟกัสเฉพาะยอดภาษีมูลค่าเพิ่มที่พิมพ์บนใบกำกับ/ใบเสร็จ
ข้ามสลิปโอนเงิน — รูปนี้ควรเป็นใบเสร็จห้างหรือใบกำกับภาษีเท่านั้น

ตอบเป็น JSON เท่านั้น:
{"hasVat":trueหรือfalse,"vatInput":จำนวนภาษีเป็นตัวเลขหรือ null,"vatBase":มูลค่าฐานภาษีหรือ null,"vatInvoiceNo":"เลขที่ใบกำกับหรือว่าง","vatSeenOnBill":trueหรือfalse,"vatReason":"สั้นๆ"}

กฎ:
- อ่านตัวเลขขวาสุดของบรรทัด "ภาษีมูลค่าเพิ่ม 7%" หรือ "VAT" → vatInput
- อ่าน "ฐานภาษี 7%" → vatBase ถ้าเห็น
- ห้ามคำนวณจากยอดรวม×7/107 (สินค้าผสม VAT/ไม่มี VAT ได้)
- ถ้าเป็นสลิปโอน/ไม่เห็นบรรทัดภาษี → hasVat=false, vatInput=null`;

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

/** พ.ศ. → ค.ศ. (2568 → 2025). ใบเสร็จไทยมักเป็นพ.ศ. */
function toCeYear(n) {
  if (!Number.isFinite(n)) return null;
  let y = n;
  while (y >= 2400 && y < 4000) y -= 543;
  if (y >= 1900 && y <= 2100) return y;
  if (y >= 0 && y < 100) return 2500 + y - 543;
  return null;
}

function normalizeDate(raw) {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [ys, ms, ds] = s.split("-").map(Number);
  const y = toCeYear(ys);
  if (y == null || y < 2000 || y > 2100) return "";
  if (!ms || ms < 1 || ms > 12 || !ds || ds < 1 || ds > 31) return "";
  const out = `${y}-${String(ms).padStart(2, "0")}-${String(ds).padStart(2, "0")}`;
  const t = Date.parse(`${out}T12:00:00+07:00`);
  if (Number.isNaN(t)) return "";
  return out;
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
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
  };
  if (richVision) {
    generationConfig.mediaResolution = "MEDIA_RESOLUTION_HIGH";
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

async function extractOneImage({ apiKey, model, imagePart, businessContext, imageIndex, imageCount }) {
  const parsed = await callGeminiJson({
    apiKey,
    model,
    imageParts: [imagePart],
    systemText: buildExtractSystemPrompt(businessContext),
    userText: `อ่านเอกสารในรูปนี้ (รูปที่ ${imageIndex}/${imageCount}) แล้วดึง JSON
ก่อนอื่นตัดสิน docKind: สลิปโอนเงิน=bank_slip / ใบเสร็จ-ใบกำกับ=tax_invoice
ถ้าเป็นใบเสร็จห้าง/ใบกำกับ ให้อ่านบรรทัดภาษีมูลค่าเพิ่มที่พิมพ์บนบิล (ห้าม×7/107)
ถ้าเป็นสลิปโอน ให้ hasVat=false`,
  });

  const type = normalizeType(parsed.type) || "อื่นๆ";
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("AI ตอบประเภทไม่ถูกต้อง");
  }

  let docKind = normalizeDocKind(parsed.docKind);
  // Heuristic fallback if model omits docKind
  if (docKind === "other") {
    const blob = `${parsed.description || ""} ${parsed.note || ""} ${parsed.vatReason || ""} ${parsed.reason || ""}`;
    if (/สลิป|โอนเงิน|promptpay|ธนาคาร|เป๋าตัง|พร้อมเพย์/i.test(blob)) {
      docKind = "bank_slip";
    } else if (
      /ท็อปเวิลด์|ท็อปส์|แม็คโคร|ใบกำกับ|ใบเสร็จ|ภาษีมูลค่าเพิ่ม|top\s*world/i.test(blob)
    ) {
      docKind = "tax_invoice";
    }
  }

  let vat = normalizeVatFields(parsed);
  if (docKind === "bank_slip") {
    vat = {
      hasVat: false,
      vatInput: null,
      vatBase: null,
      vatInvoiceNo: "",
      vatSeenOnBill: false,
      vatReason: "สลิปโอนเงิน — ไม่ใช้เป็นแหล่ง VAT",
    };
  }

  const amountOut = normalizeAmount(parsed.amountOut);

  // Retry VAT OCR only on non-bank docs when the first pass missed the tax line.
  if (docKind !== "bank_slip" && (!vat.hasVat || vat.vatInput == null)) {
    try {
      const vatParsed = await callGeminiJson({
        apiKey,
        model,
        imageParts: [imagePart],
        systemText: VAT_RETRY_SYSTEM_PROMPT,
        userText: `รอบสอง: อ่านเฉพาะยอด "ภาษีมูลค่าเพิ่ม" / "VAT" ที่พิมพ์ท้ายบิลในรูปนี้
ห้ามคำนวณจากยอดรวม — ต้องเห็นตัวเลขบนบิล`,
      });
      const retryVat = normalizeVatFields(vatParsed);
      if (retryVat.hasVat && retryVat.vatInput != null) {
        vat = retryVat;
        if (docKind === "other") docKind = "tax_invoice";
      } else if (retryVat.vatReason && !vat.vatReason) {
        vat = { ...vat, vatReason: retryVat.vatReason };
      }
    } catch (err) {
      console.warn("vat retry skip", err?.message || err);
    }
  }

  return {
    docKind,
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

async function callGeminiExtract({ apiKey, model, imageParts, businessContext }) {
  const results = [];
  for (let i = 0; i < imageParts.length; i++) {
    try {
      results.push(
        await extractOneImage({
          apiKey,
          model,
          imagePart: imageParts[i],
          businessContext,
          imageIndex: i + 1,
          imageCount: imageParts.length,
        }),
      );
    } catch (err) {
      console.warn("skip image extract", i, err?.message || err);
    }
  }
  if (!results.length) {
    throw new Error("อ่านจากรูปไม่สำเร็จ");
  }
  return mergeExtractResults(results);
}

exports.extractOwnerBookFromReceipt = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
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

// Test hooks (no firebase)
exports._mergeExtractResults = mergeExtractResults;
exports._normalizeDocKind = normalizeDocKind;
