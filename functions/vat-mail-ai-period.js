/**
 * Gemini คัดแยกช่วงรายงานเดลิเวอรี่ (ทุกแอพ) เมื่อ heuristic ไม่ชัวร์
 * หรือ owner กดบังคับ — อ่าน subject/snippet/rawText (+ ชื่อไฟล์)
 * เขียน period* / reportKind / reportDateGuess กลับ platformEmailReports
 *
 * Key: GEMINI_API_KEY → meta/aiSettings.apiKey
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  resolveReportPeriod,
  periodFieldsFromResolved,
} = require("./vat-mail-period");
const { inferMailStudyTags, tagsChanged } = require("./vat-mail-study-tags");

const REGION = "asia-southeast1";
const REPORTS_COL = "platformEmailReports";
const DEFAULT_MODEL = "gemini-2.5-flash";
const BOOTSTRAP_GEMINI_API_KEY = "";
const CONFIDENCE_NEED_AI = 0.85;
const OWNER_EMAIL = "yohaken@gmail.com";

function asString(v, max = 200) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = asString(context.auth.token?.email, 120).toLowerCase();
  if (email && email === OWNER_EMAIL) {
    return { actorId: email };
  }
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

async function callGeminiJson(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.error?.message || `Gemini error (${res.status})`;
    throw new Error(String(msg).slice(0, 240));
  }
  const text = json?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("") || "";
  return extractJsonObject(text);
}

function buildPrompt(doc) {
  const files = Array.isArray(doc.pdfFilenames)
    ? doc.pdfFilenames.join(", ")
    : "";
  const body = String(doc.rawText || doc.snippet || "").slice(0, 8000);
  return `คุณช่วยคัดแยกอีเมลรายงานยอดขาย/โอนเงินเดลิเวอรี่ไทย (Grab / LINE MAN / ShopeeFood)
อ่านหัวข้อ+เนื้อ แล้วตอบ JSON เท่านั้น ตามสคีมา:
{
  "reportKind": "daily" | "weekly" | "monthly",
  "periodStart": "YYYY-MM-DD" หรือ "",
  "periodEnd": "YYYY-MM-DD" หรือ "",
  "monthKey": "YYYY-MM",
  "reportDateGuess": "YYYY-MM-DD",
  "netHint": number|null,
  "grossHint": number|null,
  "reason": "สั้นๆ ภาษาไทย"
}

กฎ:
- ถ้าเนื้อมี "วันที่รายงาน: A ถึง B" ให้ใช้ A–B เป็น period และ monthKey จากเดือนของ B (หรือเดือนเดียวกับช่วง)
- ถ้าเป็น "ยอดขายสะสมประจำเดือน" / สรุปเดือน → reportKind=monthly แม้หัวข้อจะมีวันที่ส่งวันอื่น
- หัวข้อ Shopee "รายงานการโอนเงิน… YYYY-MM-DD" มักเป็นวันส่ง — อย่าใช้เป็นเดือนรายงานถ้าเนื้อระบุช่วงเดือนอื่น
- daily = รายงานวันเดียว; weekly = ช่วง ~7 วัน; monthly = ทั้งเดือนหรือสรุปเดือน
- ตัวเลขเงินไทยมีลูกน้ำ — แปลงเป็นตัวเลข; ไม่แน่ใจใส่ null

channel: ${doc.channel || ""}
from: ${doc.from || ""}
subject: ${doc.subject || ""}
filenames: ${files}
body:
${body}`;
}

function normalizeAiResult(raw, fallback) {
  const kind =
    raw?.reportKind === "weekly" || raw?.reportKind === "monthly"
      ? raw.reportKind
      : raw?.reportKind === "daily"
        ? "daily"
        : fallback.reportKind;
  const periodStart = String(raw?.periodStart || "").slice(0, 10);
  const periodEnd = String(raw?.periodEnd || "").slice(0, 10);
  const reportDateGuess =
    String(raw?.reportDateGuess || periodEnd || fallback.reportDateGuess || "").slice(
      0,
      10,
    );
  let monthKey = String(raw?.monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthKey) && /^\d{4}-\d{2}/.test(reportDateGuess)) {
    monthKey = reportDateGuess.slice(0, 7);
  }
  return periodFieldsFromResolved({
    reportKind: kind,
    reportDateGuess,
    periodStart: /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? periodStart : reportDateGuess,
    periodEnd: /^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ? periodEnd : reportDateGuess,
    monthKey,
    confidence: 0.9,
    source: "gemini",
  });
}

function needsAi(doc, force) {
  if (force) return true;
  const conf = Number(doc.periodConfidence);
  if (!Number.isFinite(conf) || conf < CONFIDENCE_NEED_AI) return true;
  if (doc.periodSource === "subject-date" && /ประจำเดือน|สะสมประจำเดือน|สรุปเดือน/i.test(
    `${doc.snippet || ""} ${String(doc.rawText || "").slice(0, 2000)}`,
  )) {
    return true;
  }
  return false;
}

exports.vatMailAiClassifyPeriod = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const db = getFirestore();
    const ai = await loadAiSettings(db);

    const monthKey = String(data?.monthKey || "").trim();
    const force = data?.force === true;
    const limit = Math.min(40, Math.max(1, Number(data?.limit) || 20));
    const preferHeuristic = data?.preferHeuristic !== false;
    const canGemini = Boolean(ai.enabled && ai.apiKey);

    const snap = await db.collection(REPORTS_COL).limit(500).get();
    let scanned = 0;
    let updated = 0;
    let aiCalled = 0;
    let heuristicOnly = 0;
    const samples = [];

    for (const docSnap of snap.docs) {
      if (updated >= limit) break;
      const d = docSnap.data() || {};
      scanned += 1;

      const heur = resolveReportPeriod({
        subject: d.subject,
        snippet: d.snippet,
        rawText: d.rawText,
        receivedAt: d.receivedAt || d.internalDate,
      });
      const heurFields = periodFieldsFromResolved(heur);

      if (monthKey) {
        const oldMk = String(d.periodMonthKey || d.reportDateGuess || "").slice(0, 7);
        const newMk = heurFields.periodMonthKey;
        if (newMk !== monthKey && oldMk !== monthKey) continue;
      }

      let fields = heurFields;
      let usedAi = false;
      const wantAi =
        canGemini &&
        aiCalled < limit &&
        (force ||
          !(preferHeuristic && heur.confidence >= CONFIDENCE_NEED_AI) ||
          needsAi({ ...d, ...heurFields }, false));

      if (wantAi && (force || heur.confidence < CONFIDENCE_NEED_AI)) {
        try {
          const aiRaw = await callGeminiJson(
            ai.apiKey,
            ai.model,
            buildPrompt({ ...d, channel: d.channel }),
          );
          fields = normalizeAiResult(aiRaw, heur);
          usedAi = true;
          aiCalled += 1;
        } catch (e) {
          fields = heurFields;
          if (samples.length < 8) {
            samples.push({
              id: docSnap.id,
              error: String(e?.message || e).slice(0, 120),
            });
          }
        }
      } else {
        heuristicOnly += 1;
      }

      const nextTags = inferMailStudyTags(
        {
          from: d.from,
          subject: d.subject,
          channel: d.channel,
          pdfFilenames: d.pdfFilenames,
          studyTags: d.studyTags,
          reportKind: fields.reportKind,
          snippet: d.snippet,
          rawText: d.rawText,
        },
        null,
      );

      const patch = {
        ...fields,
        periodClassifiedAt: Date.now(),
        periodClassifiedBy: usedAi ? "gemini" : "heuristic",
        periodClassifiedActor: actorId,
      };
      if (tagsChanged(d.studyTags, nextTags)) {
        patch.studyTags = nextTags;
        patch.studyTagsUpdatedAt = Date.now();
      }

      const changed =
        d.reportDateGuess !== fields.reportDateGuess ||
        d.reportKind !== fields.reportKind ||
        d.periodMonthKey !== fields.periodMonthKey ||
        d.periodStart !== fields.periodStart ||
        Boolean(patch.studyTags);

      if (!changed && !force) continue;

      await docSnap.ref.set(patch, { merge: true });
      updated += 1;
      if (samples.length < 8) {
        samples.push({
          id: docSnap.id,
          subject: String(d.subject || "").slice(0, 80),
          before: {
            reportDateGuess: d.reportDateGuess || "",
            reportKind: d.reportKind || "",
          },
          after: {
            reportDateGuess: fields.reportDateGuess,
            reportKind: fields.reportKind,
            monthKey: fields.periodMonthKey,
            source: fields.periodSource,
          },
          ai: usedAi,
        });
      }
    }

    return {
      ok: true,
      scanned,
      updated,
      aiCalled,
      heuristicOnly,
      monthKey: monthKey || null,
      samples,
    };
  });

exports.resolveReportPeriod = resolveReportPeriod;
exports.periodFieldsFromResolved = periodFieldsFromResolved;
