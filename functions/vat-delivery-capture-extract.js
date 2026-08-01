/**
 * กล่อง AI เดียว — อ่านแคปจอสรุปเดือน Grab / Shopee / LINE MAN (สูงสุด 3 รูป)
 * คัดแยกช่องทาง + ดึง 4 ช่อง → พรีวิว (ยังไม่เข้างบ)
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
const MAX_IMAGES = 3;

const SYSTEM_PROMPT = `คุณอ่านแคปจอสรุปยอดเดลิเวอรี่รายเดือนของร้าน TELL TEA / Kongsi Tea Bar ในไทย
แต่ละรูปเป็นหนึ่งแพลตฟอร์ม: GrabMerchant · ShopeeFood เมล/รายงาน · LINE MAN รายงาน/เมล GP

ตอบเป็น JSON เท่านั้น:
{
  "channel":"grab|shopee|lineman|unknown",
  "monthKey":"YYYY-MM หรือว่าง",
  "periodLabel":"ช่วงวันที่บนจอสั้นๆ",
  "sales":ตัวเลขหรือ null,
  "transfer":ตัวเลขหรือ null,
  "fee":ตัวเลขค่าสัมบูรณ์หรือ null,
  "gpVat":ตัวเลขหรือ null,
  "monthMatch":trueหรือfalse,
  "confidence":"high|medium|low",
  "notes":"สั้นๆ ภาษาไทย"
}

กฎจำแนกช่องทาง:
- grab = GrabMerchant / การเงิน / ยอดขายสุทธิ / ค่าคอมมิชชันแพลตฟอร์ม
- shopee = Kongsi Tea Bar / ShopeeFood / รายงานยอดขายสะสมประจำเดือน / ยอดรายการ / ค่าธรรมเนียม (GP)
- lineman = LINE MAN / Wongnai / ค่าบริการ GP / REPORT / ยอดโอนออกให้ร้าน

แมปตัวเลข:
- grab: sales=ยอดขายสุทธิ · transfer=รายได้/รายได้สุทธิ · fee=ค่าคอมมิชชันแพลตฟอร์ม(สัมบูรณ์) · gpVat=ถ้าไม่เห็นบนจอให้ null
- shopee: sales=ยอดรายการ (ถ้าไม่ชัดใช่ยอดที่สรุปขายสุทธิของบล็อก) · transfer=ยอดรวมสุทธิประจำเดือน · fee=ค่าธรรมเนียม(GP)+ยอดภาษีมูลค่าเพิ่มค่าธรรมเนียม · gpVat=ยอดภาษีมูลค่าเพิ่มค่าธรรมเนียม
- lineman: sales=ยอดขาย/total revenue · transfer=ยอดโอนออกให้ร้าน/payout · fee=ค่า GP รวม VAT · gpVat=null ถ้าไม่แยก
- monthKey = เดือนของช่วงรายงาน เป็น ค.ศ. (พ.ศ.ให้ลบ 543) — Shopee/LM ใช้เดือนในรายงาน ไม่ใช่วันส่งเมล
- monthMatch = true ถ้า monthKey ตรง selectedMonthKey
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
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
    }),
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

function normalizeChannel(raw) {
  const c = String(raw || "")
    .trim()
    .toLowerCase();
  if (c === "grab" || c === "gb") return "grab";
  if (c === "shopee" || c === "shopeefood" || c === "sf") return "shopee";
  if (c === "lineman" || c === "line man" || c === "lm" || c === "wongnai") {
    return "lineman";
  }
  return "unknown";
}

function normalizeItem(raw, selectedMonthKey, imageIndex) {
  const channel = normalizeChannel(raw.channel);
  const sales = absMoney(raw.sales);
  const transfer = absMoney(raw.transfer);
  let fee = absMoney(raw.fee);
  let gpVat =
    raw.gpVat == null || raw.gpVat === "" ? null : absMoney(raw.gpVat);

  // Shopee: ถ้า fee ≈ GP อย่างเดียว (VAT ≈ fee×7%) → คชจ. = GP+VAT
  if (channel === "shopee" && gpVat > 0 && fee > 0) {
    const expectedVat = roundMoney(fee * 0.07);
    if (Math.abs(expectedVat - gpVat) <= 0.05) {
      fee = roundMoney(fee + gpVat);
    }
  }

  if (!(gpVat > 0) && fee > 0) {
    gpVat = gpVatFromFee(fee);
  }

  let monthKey = asString(raw.monthKey, 7);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) monthKey = "";
  const monthMatch =
    Boolean(raw.monthMatch) ||
    (selectedMonthKey && monthKey && selectedMonthKey === monthKey);

  const warnings = [];
  if (channel === "unknown") warnings.push("จำแนกช่องทางไม่ได้");
  if (selectedMonthKey && monthKey && selectedMonthKey !== monthKey) {
    warnings.push(`เดือนในรูป ${monthKey} ≠ ที่เลือก ${selectedMonthKey}`);
  }
  if (!(sales > 0) || !(transfer > 0)) {
    warnings.push("อ่านขาย/โอนไม่ครบ");
  }

  return {
    imageIndex,
    channel,
    monthKey,
    periodLabel: asString(raw.periodLabel, 80),
    sales,
    transfer,
    fee,
    gpVat: gpVat || 0,
    monthMatch: Boolean(monthMatch),
    confidence: asString(raw.confidence, 16) || "medium",
    notes: asString(raw.notes, 200),
    warnings,
    ok: channel !== "unknown" && (sales > 0 || transfer > 0),
  };
}

exports.vatDeliveryCaptureExtract = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 180, memory: "1GB" })
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
    const imagesRaw = Array.isArray(data?.images) ? data.images : [];
    if (!imagesRaw.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "ต้องส่งรูปอย่างน้อย 1 ใบ (สูงสุด 3)",
      );
    }
    if (imagesRaw.length > MAX_IMAGES) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `ส่งได้สูงสุด ${MAX_IMAGES} รูป`,
      );
    }

    const parsedImages = imagesRaw.map((img, i) => {
      const url = typeof img === "string" ? img : img?.imageDataUrl;
      const parsed = parseDataUrl(url);
      if (!parsed) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `รูปที่ ${i + 1} ไม่ใช่ data URL ภาพ`,
        );
      }
      return parsed;
    });

    const items = [];
    const errors = [];
    for (let i = 0; i < parsedImages.length; i += 1) {
      const img = parsedImages[i];
      try {
        const raw = await callGeminiVisionJson({
          apiKey: ai.apiKey,
          model: ai.model,
          mimeType: img.mimeType,
          data: img.data,
          userText: `อ่านแคปจอสรุปเดลิเวอรี่รูปที่ ${i + 1}/${parsedImages.length}
selectedMonthKey ที่เจ้าของเลือก = ${selectedMonthKey || "(ไม่ระบุ)"}
ร้าน: TELL TEA / Kongsi Tea Bar
ดึง JSON ตามระบบ (จำแนก grab|shopee|lineman)`,
        });
        items.push(normalizeItem(raw, selectedMonthKey, i));
      } catch (e) {
        const msg = asString(e?.message || String(e), 200);
        errors.push(`รูป ${i + 1}: ${msg}`);
        items.push({
          imageIndex: i,
          channel: "unknown",
          monthKey: "",
          periodLabel: "",
          sales: 0,
          transfer: 0,
          fee: 0,
          gpVat: 0,
          monthMatch: false,
          confidence: "low",
          notes: msg,
          warnings: [msg],
          ok: false,
        });
      }
    }

    // รวมต่อช่องทาง — ถ้าซ้ำช่องทาง ใช้ใบที่ confidence สูง / มียอดครบกว่า
    const byChannel = { grab: null, shopee: null, lineman: null };
    const rank = { high: 3, medium: 2, low: 1 };
    for (const it of items) {
      if (it.channel !== "grab" && it.channel !== "shopee" && it.channel !== "lineman") {
        continue;
      }
      const prev = byChannel[it.channel];
      if (!prev) {
        byChannel[it.channel] = it;
        continue;
      }
      const prevScore =
        (rank[prev.confidence] || 0) + (prev.ok ? 2 : 0) + (prev.monthMatch ? 1 : 0);
      const nextScore =
        (rank[it.confidence] || 0) + (it.ok ? 2 : 0) + (it.monthMatch ? 1 : 0);
      if (nextScore >= prevScore) byChannel[it.channel] = it;
    }

    return {
      ok: items.some((x) => x.ok),
      selectedMonthKey,
      model: ai.model,
      items,
      byChannel,
      errors,
    };
  });
