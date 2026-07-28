/**
 * Owner-only push alerts for missing VAT mail / parse failures.
 * Schedule: daily late morning Asia/Bangkok.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const webpush = require("web-push");

const REGION = "asia-southeast1";
const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ||
  "BI74S6JyDs61V0eqRuS9iy6XdhER9wtA-EXhLfWiEFZSeg2VBBQM1dnPnFsyVY2AQzcKF7gHZm-Eifpsc7cF0Zg";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

function bangkokParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "0";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hour: Number(get("hour")),
  };
}

function bangkokDateKeyFromParts({ y, m, d }) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function yesterdayBangkokKey(now = Date.now()) {
  const p = bangkokParts(now);
  const utc = Date.UTC(p.y, p.m - 1, p.d) - 7 * 60 * 60 * 1000;
  const yMs = utc - 24 * 60 * 60 * 1000;
  return bangkokDateKeyFromParts(bangkokParts(yMs));
}

async function sendToOwnerSubscriptions(payload) {
  if (!VAPID_PRIVATE) {
    console.error("VAPID_PRIVATE_KEY missing — skip vat alert push");
    return { sent: 0, failed: 0 };
  }
  webpush.setVapidDetails("mailto:yohaken@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);
  const db = getFirestore();
  const snap = await db.collection("pushSubscriptions").where("role", "==", "owner").get();
  if (snap.empty) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    snap.docs.map(async (docSnap) => {
      const data = docSnap.data();
      try {
        await webpush.sendNotification(
          { endpoint: data.endpoint, keys: data.keys },
          body,
          { TTL: 60 * 60 },
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await docSnap.ref.delete().catch(() => undefined);
        }
      }
    }),
  );
  return { sent, failed };
}

async function evaluateYesterday(db, dateKey) {
  const settingsSnap = await db.doc("meta/vatSalesSettings").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  if (settings.alertsEnabled === false) {
    return { skip: true, reason: "alerts_disabled" };
  }

  const daySnap = await db.collection("dailySales").doc(dateKey).get();
  if (daySnap.exists && daySnap.get("status") === "confirmed") {
    return { skip: true, reason: "day_confirmed" };
  }

  const channels = ["shopee", "grab", "lineman"].filter((ch) => {
    const en = settings.channelsEnabled || {};
    return en[ch] !== false;
  });

  const reportsSnap = await db
    .collection("platformEmailReports")
    .where("reportDateGuess", "==", dateKey)
    .limit(50)
    .get();
  // Also scan recent if reportDateGuess missing — lightweight fallback
  let reports = reportsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (reports.length === 0) {
    const recent = await db
      .collection("platformEmailReports")
      .orderBy("receivedAt", "desc")
      .limit(80)
      .get();
    reports = recent.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => {
        const rd = String(r.parsed?.reportDate || r.reportDateGuess || "");
        return rd === dateKey;
      });
  }

  const relevant = reports.filter(
    (r) => r.channel === "unknown" || channels.includes(r.channel),
  );
  const pending = relevant.filter((r) => r.parseStatus === "ok").length;
  const fails = relevant.filter((r) => r.parseStatus === "fail").length;
  const hasMail = relevant.some((r) => r.parseStatus !== "ignored");

  const day = daySnap.exists ? daySnap.data() : null;
  const filled = channels.filter((ch) => {
    const g = Number(day?.delivery?.[ch]?.grossInclusive) || 0;
    const ref = day?.emailRefs?.[ch];
    return g > 0 || Boolean(ref);
  }).length;

  let kind = "";
  if (fails > 0) kind = "parse_error";
  else if (pending > 0) kind = "pending_review";
  else if (!hasMail && filled === 0) kind = "missing_mail";
  else return { skip: true, reason: "ok_or_partial" };

  return {
    skip: false,
    kind,
    dateKey,
    pending,
    fails,
    filled,
    channels: channels.length,
  };
}

exports.vatSalesDailyAlert = functions
  .region(REGION)
  .pubsub.schedule("0 10 * * *")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const db = getFirestore();
    const dateKey = yesterdayBangkokKey();
    const evalResult = await evaluateYesterday(db, dateKey);
    if (evalResult.skip) {
      console.log("vatSalesDailyAlert skip", dateKey, evalResult.reason);
      return null;
    }

    const title =
      evalResult.kind === "missing_mail"
        ? "ขาดเมลรายงานยอดขาย"
        : evalResult.kind === "parse_error"
          ? "เมลยอดขาย parse ไม่ผ่าน"
          : "มีเมลยอดขายรอตรวจ";
    const body =
      evalResult.kind === "missing_mail"
        ? `วานนี้ (${dateKey}) ยังไม่มีเมลแพลตฟอร์ม — เปิดยอดขาย/VAT เพื่อตรวจ`
        : evalResult.kind === "parse_error"
          ? `วานนี้ (${dateKey}) มีเมล parse ไม่ผ่าน — เปิดกล่องเมลเพื่อตรวจ`
          : `วานนี้ (${dateKey}) มีเมลรอตรวจ ${evalResult.pending} ฉบับ`;

    const push = await sendToOwnerSubscriptions({
      title,
      body,
      url: "/vat-sales/?tab=mail",
      tag: `vat-sales-${dateKey}`,
    });

    await db.doc("meta/vatSalesAlertState").set(
      {
        lastAlertDateKey: dateKey,
        lastAlertKind: evalResult.kind,
        lastAlertAt: Date.now(),
        lastPush: push,
      },
      { merge: true },
    );
    console.log("vatSalesDailyAlert sent", dateKey, evalResult.kind, push);
    return null;
  });

/** Owner callable — ตรวจ/ยิงแจ้งเตือนเมื่อวานทันที (เทส) */
exports.vatSalesAlertCheck = functions.region(REGION).https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = String(context.auth.token?.email || "")
    .trim()
    .toLowerCase();
  const db = getFirestore();
  let isOwner = email === String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com").toLowerCase();
  if (!isOwner && email) {
    const staff = await db.collection("staff").doc(email).get();
    isOwner = staff.exists && staff.get("role") === "owner";
  }
  if (!isOwner) {
    throw new functions.https.HttpsError("permission-denied", "เฉพาะเจ้าของ");
  }

  const dateKey = yesterdayBangkokKey();
  const evalResult = await evaluateYesterday(db, dateKey);
  if (evalResult.skip) return { dateKey, ...evalResult, pushed: false };

  const title =
    evalResult.kind === "missing_mail"
      ? "ขาดเมลรายงานยอดขาย"
      : evalResult.kind === "parse_error"
        ? "เมลยอดขาย parse ไม่ผ่าน"
        : "มีเมลยอดขายรอตรวจ";
  const body = `วานนี้ (${dateKey}) — เปิดยอดขาย/VAT เพื่อจัดการ`;
  const push = await sendToOwnerSubscriptions({
    title,
    body,
    url: "/vat-sales/?tab=mail",
    tag: `vat-sales-${dateKey}`,
  });
  return { dateKey, ...evalResult, pushed: true, push };
});
