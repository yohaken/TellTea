/**
 * Production photo conflict check via Gemini (multimodal).
 * Detects conflicts within a confusion group only — NOT exact flavor match.
 * Resolves evp: refs from evidencePhotos (same as extract-cash-deposit).
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

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยตรวจความขัดแย้งของรูปสินค้าผลิตเบเกอรี่ร้าน TellTea
เป้าหมายคือหาว่า "รูปในภาพขัดแย้งกับสินค้าที่พนักงานเลือก" ในกลุ่มสินค้าที่สับสนง่ายเท่านั้น — ไม่ใช่การยืนยันว่ารสชาติตรง 100%

ตอบเป็น JSON เท่านั้น:
{"conflictLevel":"none|conflict|uncertain","suggestedProductName":"ชื่อจากรายการกลุ่มหรือว่าง","reason":"เหตุผลสั้นๆ ภาษาไทยไม่เกิน 40 ตัวอักษร"}

กฎสำคัญ:
- conflict = รูปมองเห็นชัดว่าเป็นสมาชิกอื่นในกลุ่ม ไม่ใช่สินค้าที่เลือก (เช่น เลือกขนมปังมันม่วง แต่รูปชัดว่าเป็นมันอบ/มันไทยอบ)
- none = ไม่เห็นความขัดแย้งชัด (รูปเข้ากับสินค้าที่เลือก หรือแยกไม่ได้)
- uncertain = มองไม่ชัด / มุมมืด / ห่อปิด / ไม่มีสินค้าในรูป
- suggestedProductName ต้องเป็นหนึ่งในรายชื่อกลุ่มที่ให้มาเท่านั้น ถ้าไม่แน่ใจให้ว่าง
- ห้ามฟันธง conflict จากรสชาติในห่อเดียวกัน (เช่น คุกกี้รสช็อกโกแลต vs มัจฉะ) — ถ้ายังดูเป็นประเภทเดียวกันให้ none หรือ uncertain
- ห้ามแต่งข้อมูลที่มองไม่เห็นในรูป
- ถ้ากลุ่มระบุว่าห้ามแยกรส (flavorBlind) ให้ตอบ none เสมอเมื่อยังดูเป็นสินค้าประเภทนั้น`;

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

async function resolveImagePart(db, rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) throw new Error("ไม่มี URL รูป");
  if (raw.startsWith("data:")) return partFromDataUrl(raw);
  if (raw.startsWith("evp:")) {
    const id = raw.slice(4).trim();
    if (!id) throw new Error("รหัสรูปไม่ถูกต้อง");
    const snap = await db.doc(`evidencePhotos/${id}`).get();
    if (!snap.exists) throw new Error("ไม่พบรูปหลักฐาน");
    const dataUrl = String(snap.data()?.dataUrl || "");
    return partFromDataUrl(dataUrl);
  }
  if (!isAllowedImageUrl(raw)) throw new Error("URL รูปไม่ได้รับอนุญาต");
  return fetchImagePart(raw);
}

function normalizeConflictLevel(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase();
  if (t === "conflict" || t === "none" || t === "uncertain") return t;
  return null;
}

function normalizeNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function pickSuggestedName(raw, groupNames, selectedName) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const key = normalizeNameKey(s);
  const hit = groupNames.find((n) => normalizeNameKey(n) === key);
  if (hit) return hit;
  const partial = groupNames.find(
    (n) => normalizeNameKey(n).includes(key) || key.includes(normalizeNameKey(n)),
  );
  if (partial) return partial;
  // Do not invent names outside the group
  if (normalizeNameKey(selectedName) === key) return selectedName;
  return "";
}

async function callGemini({
  apiKey,
  model,
  selectedProductName,
  groupProductNames,
  groupLabel,
  flavorBlind,
  imageParts,
  businessContext,
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const groupList = groupProductNames.map((n) => `- ${n}`).join("\n");
  const textHint = [
    `กลุ่มสับสน: ${groupLabel || "ไม่ระบุ"}`,
    flavorBlind ? "กฎพิเศษ: flavorBlind=true — ห้ามฟันธง conflict จากรสในห่อ ให้ตอบ none" : "",
    `สินค้าที่พนักงานเลือก: ${selectedProductName}`,
    `รายชื่อในกลุ่ม (เลือก suggested ได้เฉพาะเหล่านี้):`,
    groupList,
    `(มีรูปหลักฐาน ${imageParts.length} รูป)`,
  ]
    .filter(Boolean)
    .join("\n");

  const parts = [...imageParts, { text: textHint }];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      systemInstruction: {
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\nบริบทกิจการ:\n${businessContext || DEFAULT_BUSINESS_CONTEXT}`,
          },
        ],
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
  let conflictLevel = normalizeConflictLevel(parsed?.conflictLevel);
  // Fail soft — invalid/missing level → uncertain (client may ask staff to confirm).
  if (!conflictLevel) {
    conflictLevel = "uncertain";
  }

  if (flavorBlind && conflictLevel === "conflict") {
    conflictLevel = "none";
  }

  const suggestedProductName = pickSuggestedName(
    parsed?.suggestedProductName,
    groupProductNames,
    selectedProductName,
  );
  const reason = String(parsed?.reason || "").trim().slice(0, 80);

  return {
    conflictLevel,
    suggestedProductName,
    reason,
    usedImages: imageParts.length,
  };
}

exports.verifyProdPhotoConflict = functions
  .region("asia-southeast1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onCall(async (data, context) => {
    requireStaff(context);

    const selectedProductName = String(data?.selectedProductName || "").trim();
    if (!selectedProductName) {
      throw new functions.https.HttpsError("invalid-argument", "ต้องใส่ชื่อสินค้าที่เลือก");
    }
    if (selectedProductName.length > 120) {
      throw new functions.https.HttpsError("invalid-argument", "ชื่อสินค้ายาวเกินไป");
    }

    const groupProductNames = (Array.isArray(data?.groupProductNames) ? data.groupProductNames : [])
      .map((n) => String(n || "").trim())
      .filter(Boolean)
      .slice(0, 20);
    if (groupProductNames.length < 2) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "ต้องมีรายชื่อในกลุ่มอย่างน้อย 2 รายการ",
      );
    }

    const flavorBlind = Boolean(data?.flavorBlind);
    const groupLabel = String(data?.groupLabel || "").trim().slice(0, 80);
    const rawImages = Array.isArray(data?.imageUrls) ? data.imageUrls : [];
    const imageUrls = rawImages
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, MAX_IMAGES);

    if (!imageUrls.length) {
      throw new functions.https.HttpsError("invalid-argument", "ต้องมีรูปอย่างน้อย 1 รูป");
    }

    if (flavorBlind) {
      return {
        conflictLevel: "none",
        suggestedProductName: "",
        reason: "กลุ่มนี้ไม่แยกรสจากรูปห่อ",
        model: "",
        usedImages: 0,
        skipped: true,
        skipReason: "flavorBlind",
      };
    }

    const db = getFirestore();
    const settings = await loadAiSettings(db);
    if (!settings.enabled) {
      throw new functions.https.HttpsError("failed-precondition", "ปิดการตรวจด้วย AI อยู่");
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
    for (const imageUrl of imageUrls) {
      if (imageParts.length >= MAX_IMAGES) break;
      try {
        imageParts.push(await resolveImagePart(db, imageUrl));
      } catch (err) {
        console.warn("skip image for prod photo qa", err?.message || err);
      }
    }
    if (!imageParts.length) {
      throw new functions.https.HttpsError("invalid-argument", "โหลดรูปหลักฐานไม่สำเร็จ");
    }

    try {
      const result = await callGemini({
        apiKey: settings.apiKey,
        model,
        selectedProductName,
        groupProductNames,
        groupLabel,
        flavorBlind,
        imageParts,
        businessContext,
      });
      return {
        conflictLevel: result.conflictLevel,
        suggestedProductName: result.suggestedProductName,
        reason: result.reason,
        model,
        usedImages: result.usedImages,
      };
    } catch (err) {
      console.error("verifyProdPhotoConflict failed", err?.message || err);
      throw new functions.https.HttpsError(
        "internal",
        `ตรวจรูปผลิตด้วย AI ไม่สำเร็จ — ${String(err?.message || err).slice(0, 120)}`,
      );
    }
  });

exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
exports.normalizeConflictLevel = normalizeConflictLevel;
exports.pickSuggestedName = pickSuggestedName;
