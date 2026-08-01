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

const SYSTEM_PROMPT = `คุณอ่านแคปจอสรุปยอดเดลิเวอรี่รายเดือนของร้าน TELL TEA / Kongsi Tea Bar
แต่ละรูป = หนึ่งแพลตฟอร์ม (GrabMerchant · ShopeeFood · LINE MAN)

ตอบ JSON เท่านั้น:
{"channel":"grab|shopee|lineman|unknown","monthKey":"YYYY-MM หรือว่าง","periodLabel":"สั้นๆ","sales":ตัวเลข|null,"transfer":ตัวเลข|null,"fee":ตัวเลข|null,"gpVat":ตัวเลข|null,"monthMatch":true|false,"confidence":"high|medium|low","notes":"สั้นๆ"}

จำแนก:
- grab = GrabMerchant / การเงิน / ยอดขายสุทธิ / ค่าคอมมิชชัน
- shopee = ShopeeFood / Kongsi Tea Bar / รายงานยอดขายสะสมประจำเดือน / ค่าธรรมเนียม(GP)
- lineman = LINE MAN / Wongnai / ค่าบริการ GP / ยอดโอนออกให้ร้าน

แมปตัวเลข (สำคัญ — อย่าสลับคอลัมน์):
- sales = ยอดขายแอพ (ฐานคำนวณ VAT ขาย) · ใช้ยอดรวมตามที่แพลตฟอร์มแสดง · ห้ามหัก GP/VAT ออกเอง
- transfer = ยอดโอนเข้าบัญชีร้าน (= รายได้ในงบ) · ห้ามสลับกับ sales
- fee = คชจ.GP ต้องเป็นยอดก่อน VAT (ex-VAT) · ห้ามใส่ยอดรวมที่มี VAT ปนถ้าจอแยกไว้แล้ว
- gpVat = VAT ของค่า GP (VAT-ซื้อ) · คู่กับ fee

กฎ VAT ของคชจ. (ต้องทำตาม):
1) จอ/เมลแยก fee กับ VAT แล้ว → fee=ยอดก่อน VAT · gpVat=ยอด VAT ตามที่เห็น
2) จอมีแต่ยอด GP รวม VAT (ไม่แยก) → ส่งยอดรวมใน fee และ gpVat=null (ระบบจะแยก ×7/107 ให้)
3) ห้ามลบ VAT ออกจาก sales หรือ transfer
4) ห้ามคิด fee จาก sales−transfer ถ้าจอมีตัวเลข fee/GP ชัดเจนอยู่แล้ว

แมปรายช่องทาง:
- grab: sales=ยอดขายสุทธิ · transfer=รายได้/รายได้สุทธิ · fee=ค่าคอมมิชชัน · gpVat=ถ้าแยก
- shopee: sales=ยอดรายการ · transfer=ยอดรวมสุทธิประจำเดือน · fee=ค่าธรรมเนียม(GP) · gpVat=ภาษีมูลค่าเพิ่มค่าธรรมเนียม
- lineman: sales=ยอดขาย/total revenue · transfer=ยอดโอนออกให้ร้าน · fee=ค่า GP · gpVat=ถ้าแยก

เดือน: monthKey=เดือนของช่วงรายงาน ค.ศ. (พ.ศ.−543) · Shopee/LM ใช้เดือนในรายงาน ไม่ใช่วันส่งเมล
monthMatch=true ถ้า monthKey ตรง selectedMonthKey
ห้ามแต่งตัวเลขที่มองไม่เห็น`;

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
  if (!s) throw new Error("Gemini ไม่ได้คืน JSON");
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : s;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini ไม่ได้คืน JSON");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("Gemini คืน JSON ไม่สมบูรณ์");
  }
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

async function postGeminiVision({ apiKey, model, mimeType, data, userText, withThinking }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
  };
  if (withThinking) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
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
      generationConfig,
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function callGeminiVisionJson({ apiKey, model, mimeType, data, userText }) {
  let { res, json } = await postGeminiVision({
    apiKey,
    model,
    mimeType,
    data,
    userText,
    withThinking: true,
  });
  if (!res.ok) {
    const msg = String(json?.error?.message || `Gemini error (${res.status})`);
    if (/thinkingConfig|Unknown name|Invalid JSON/i.test(msg)) {
      ({ res, json } = await postGeminiVision({
        apiKey,
        model,
        mimeType,
        data,
        userText,
        withThinking: false,
      }));
    } else {
      throw new Error(msg.slice(0, 240));
    }
  }
  if (!res.ok) {
    throw new Error(
      String(json?.error?.message || `Gemini error (${res.status})`).slice(0, 240),
    );
  }
  const candidate = json?.candidates?.[0];
  const finish = String(candidate?.finishReason || "");
  const text =
    candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text.trim()) {
    throw new Error(
      finish && finish !== "STOP"
        ? `Gemini ว่าง (${finish})`
        : "Gemini ไม่ได้คืน JSON",
    );
  }
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

/** คชจ. ต้องไม่รวม VAT · แยก gpVat ออกถ้าจอรวมมา */
function splitFeeExVat(feeRaw, vatRaw) {
  let fee = absMoney(feeRaw);
  let gpVat =
    vatRaw == null || vatRaw === "" ? null : absMoney(vatRaw);
  if (!(fee > 0)) {
    return { fee: 0, gpVat: gpVat > 0 ? gpVat : 0 };
  }
  if (gpVat > 0) {
    const vatFromEx = roundMoney(fee * 0.07);
    const vatFromIncl = gpVatFromFee(fee);
    // fee เป็นยอดไม่รวม VAT อยู่แล้ว (VAT ≈ fee×7%)
    if (Math.abs(vatFromEx - gpVat) <= 0.05) {
      return { fee, gpVat };
    }
    // fee รวม VAT อยู่ (VAT ≈ fee×7/107) → แยกออก
    if (Math.abs(vatFromIncl - gpVat) <= 0.05) {
      return { fee: roundMoney(fee - gpVat), gpVat };
    }
    // มี VAT แยกแต่ความสัมพันธ์ไม่ชัด — สมมติ fee ไม่รวม VAT
    return { fee, gpVat };
  }
  // ไม่แยกบนจอ → fee รวม VAT · แยกด้วย ×7/107
  gpVat = gpVatFromFee(fee);
  return { fee: roundMoney(fee - gpVat), gpVat };
}

function normalizeItem(raw, selectedMonthKey, imageIndex) {
  const channel = normalizeChannel(raw.channel);
  const sales = absMoney(raw.sales);
  const transfer = absMoney(raw.transfer);
  const split = splitFeeExVat(raw.fee, raw.gpVat);
  const fee = split.fee;
  const gpVat = split.gpVat;

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
    gpVat,
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
