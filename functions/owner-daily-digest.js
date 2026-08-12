/**
 * Owner morning digest → LINE Messaging API.
 * Runs hourly; sends once when Asia/Bangkok hour matches digestHour (default 8).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const webpush = require("web-push");
const {
  bangkokParts,
  bangkokDateKeyFromParts,
  formatBaht,
  hourInWindow,
  parseNotify,
  sendLinePush,
  loadOwnerNotify,
} = require("./line-owner");

const LOW_BALANCE_COOLDOWN_MS = 3 * 60 * 60 * 1000;

const REGION = "asia-southeast1";
const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ||
  "BI74S6JyDs61V0eqRuS9iy6XdhER9wtA-EXhLfWiEFZSeg2VBBQM1dnPnFsyVY2AQzcKF7gHZm-Eifpsc7cF0Zg";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

function yesterdayBangkokKey(now = Date.now()) {
  const p = bangkokParts(now);
  const utc = Date.UTC(p.y, p.m - 1, p.d) - 7 * 60 * 60 * 1000;
  const yMs = utc - 24 * 60 * 60 * 1000;
  return bangkokDateKeyFromParts(bangkokParts(yMs));
}

function startMsFromDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
}

async function sendToOwnerSubscriptions(payload) {
  if (!VAPID_PRIVATE) {
    return { sent: 0, failed: 0, skipped: "no_vapid" };
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

function normalizePosPayment(raw) {
  const m = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (m === "promptpay") return "promptpay";
  if (m === "transfer" || m === "bank" || m === "bank_transfer") return "transfer";
  return "cash";
}

async function sumYesterdayPosSales(db, dateKey) {
  const start = startMsFromDateKey(dateKey);
  const end = start + 24 * 60 * 60 * 1000 - 1;
  const windows = [
    [start, end],
    [start + 7 * 60 * 60 * 1000, end + 7 * 60 * 60 * 1000],
  ];
  const seen = new Set();
  let gross = 0;
  let bills = 0;
  let cash = 0;
  let transfer = 0;
  for (const [a, b] of windows) {
    const snap = await db
      .collection("posSales")
      .where("date", ">=", a)
      .where("date", "<=", b)
      .get();
    for (const docSnap of snap.docs) {
      if (seen.has(docSnap.id)) continue;
      seen.add(docSnap.id);
      const data = docSnap.data() || {};
      if (data.status === "voided") continue;
      const total = Number(data.total) || 0;
      if (!(total > 0)) continue;
      const dateMs = typeof data.date === "number" ? data.date : 0;
      if (dateMs) {
        const key = bangkokDateKeyFromParts(bangkokParts(dateMs));
        if (key !== dateKey) continue;
      }
      bills += 1;
      gross += total;
      const pay = normalizePosPayment(data.paymentMethod);
      if (pay === "cash") cash += total;
      else transfer += total;
    }
  }
  return { gross, bills, cash, transfer };
}

async function pendingBillNotices(db) {
  const snap = await db
    .collection("billNotices")
    .where("status", "==", "pending")
    .limit(40)
    .get();
  let sum = 0;
  const rows = [];
  for (const docSnap of snap.docs) {
    const d = docSnap.data() || {};
    const amount = Number(d.amountOut) || 0;
    sum += amount;
    rows.push({
      description: String(d.description || "บิล").slice(0, 40),
      amount,
      staffName: String(d.staffName || "").slice(0, 24),
    });
  }
  return { count: snap.size, sum, rows };
}

async function memberCount(db) {
  try {
    const agg = await db.collection("members").count().get();
    return Number(agg.data().count) || 0;
  } catch {
    const snap = await db.collection("members").select().get();
    return snap.size;
  }
}

async function buildDigestText(db, notify, now = Date.now()) {
  const todayKey = bangkokDateKeyFromParts(bangkokParts(now));
  const yKey = yesterdayBangkokKey(now);
  const lines = [`TellTea สรุปเช้า ${todayKey}`];

  if (notify.includeLowBalance) {
    const [ledgerSnap, settingsSnap] = await Promise.all([
      db.doc("meta/ledger").get(),
      db.doc("meta/settings").get(),
    ]);
    const balance = Number(ledgerSnap.exists ? ledgerSnap.get("balance") : 0);
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const threshold = Number(settings.lowBalanceThreshold);
    const thresholdSafe = Number.isFinite(threshold) ? threshold : 5000;
    const enabled = settings.lowBalanceEnabled !== false;
    const low = enabled && balance < thresholdSafe;
    lines.push("");
    lines.push("เงินคงเหลือพนักงาน");
    lines.push(`· คงเหลือ ${formatBaht(balance)}`);
    if (enabled) {
      lines.push(
        low
          ? `· ⚠ ต่ำกว่าเกณฑ์ ${formatBaht(thresholdSafe)}`
          : `· เกณฑ์ขั้นต่ำ ${formatBaht(thresholdSafe)}`,
      );
    }
  }

  if (notify.includeBillNotices) {
    const bills = await pendingBillNotices(db);
    lines.push("");
    lines.push("แจ้งบิลรอชำระ");
    if (!bills.count) {
      lines.push("· ไม่มีรายการค้าง");
    } else {
      lines.push(`· ${bills.count} รายการ รวม ${formatBaht(bills.sum)}`);
      for (const row of bills.rows.slice(0, 8)) {
        const who = row.staffName ? ` (${row.staffName})` : "";
        lines.push(`· ${row.description}${who} ${formatBaht(row.amount)}`);
      }
      if (bills.rows.length > 8) {
        lines.push(`· …อีก ${bills.rows.length - 8} รายการ`);
      }
    }
  }

  if (notify.includeYesterdaySales) {
    const sales = await sumYesterdayPosSales(db, yKey);
    lines.push("");
    lines.push(`ยอดขายหน้าร้าน ${yKey}`);
    lines.push(`· รวม ${formatBaht(sales.gross)} · ${sales.bills} บิล`);
    lines.push(
      `· สด ${formatBaht(sales.cash)} · โอน/พร้อมเพย์ ${formatBaht(sales.transfer)}`,
    );
  }

  if (notify.includeMemberCount) {
    const count = await memberCount(db);
    lines.push("");
    lines.push(`สมาชิกทั้งหมด ${count.toLocaleString("th-TH")} คน`);
  }

  lines.push("");
  lines.push("เปิดแอป: https://telltea-bo.web.app/");
  return lines.join("\n");
}

async function assertOwnerCallable(context) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบ");
  }
  const email = String(context.auth.token?.email || "").trim().toLowerCase();
  const db = getFirestore();
  let isOwner =
    email === String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com").toLowerCase();
  if (!isOwner && email) {
    const staff = await db.collection("staff").doc(email).get();
    isOwner = staff.exists && staff.get("role") === "owner";
  }
  if (!isOwner) {
    throw new functions.https.HttpsError("permission-denied", "เฉพาะเจ้าของ");
  }
}

async function runDigest({ force = false, now = Date.now() } = {}) {
  const db = getFirestore();
  const notify = await loadOwnerNotify(db);

  if (!notify.dailyDigestEnabled && !force) {
    return { skip: true, reason: "digest_disabled" };
  }

  const parts = bangkokParts(now);
  const todayKey = bangkokDateKeyFromParts(parts);
  if (!force && parts.hour !== notify.digestHour) {
    return { skip: true, reason: "wrong_hour", hour: parts.hour, want: notify.digestHour };
  }

  const stateRef = db.doc("meta/ownerDailyDigestState");
  if (!force) {
    const stateSnap = await stateRef.get();
    if (stateSnap.exists && stateSnap.get("lastSentDateKey") === todayKey) {
      return { skip: true, reason: "already_sent", dateKey: todayKey };
    }
  }

  const text = await buildDigestText(db, notify, now);
  const result = {
    dateKey: todayKey,
    line: null,
    push: null,
    preview: text.slice(0, 200),
  };

  if (notify.channelAccessToken && notify.lineUserId) {
    try {
      await sendLinePush(notify.channelAccessToken, notify.lineUserId, text);
      result.line = { ok: true };
    } catch (err) {
      result.line = { ok: false, error: String(err?.message || err) };
    }
  } else {
    result.line = { ok: false, error: "missing_line_credentials" };
  }

  if (notify.webPushOnDigest) {
    result.push = await sendToOwnerSubscriptions({
      title: "TellTea — สรุปเช้า",
      body: text.replace(/\n+/g, " · ").slice(0, 160),
      url: "https://telltea-bo.web.app/",
    });
  }

  const sentOk = Boolean(result.line?.ok) || (result.push && result.push.sent > 0);
  if (sentOk || force) {
    await stateRef.set(
      {
        lastSentDateKey: todayKey,
        lastSentAt: Date.now(),
        lastResult: {
          line: result.line,
          push: result.push,
        },
        lastPreview: text.slice(0, 500),
      },
      { merge: true },
    );
  }

  return result;
}

/** If balance stayed low overnight, send LINE once we enter the configured hours. */
async function flushDeferredLowBalanceLine(db, now = Date.now()) {
  const [notify, settingsSnap, ledgerSnap, alertSnap] = await Promise.all([
    loadOwnerNotify(db),
    db.doc("meta/settings").get(),
    db.doc("meta/ledger").get(),
    db.doc("meta/lowBalanceAlert").get(),
  ]);
  if (notify.instantLineEnabled === false) {
    return { skip: true, reason: "instant_disabled" };
  }
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  if (settings.lowBalanceEnabled === false) {
    return { skip: true, reason: "threshold_disabled" };
  }
  const threshold = Number(settings.lowBalanceThreshold);
  const thresholdSafe = Number.isFinite(threshold) ? threshold : 5000;
  const balance = Number(ledgerSnap.exists ? ledgerSnap.get("balance") : NaN);
  if (!Number.isFinite(balance) || balance >= thresholdSafe) {
    return { skip: true, reason: "not_low" };
  }
  const hour = bangkokParts(now).hour;
  if (!hourInWindow(hour, notify.instantHourStart, notify.instantHourEnd)) {
    return { skip: true, reason: "outside_hours", hour };
  }
  if (!notify.channelAccessToken || !notify.lineUserId) {
    return { skip: true, reason: "missing_line_credentials" };
  }
  const alert = alertSnap.exists ? alertSnap.data() : {};
  const lastLineAt = Number(alert.lastLineAt || alert.lastPushAt) || 0;
  if (Date.now() - lastLineAt < LOW_BALANCE_COOLDOWN_MS) {
    return { skip: true, reason: "cooldown" };
  }

  const text = [
    "TellTea — เงินคงเหลือต่ำ",
    `คงเหลือ ${formatBaht(balance)}`,
    `ต่ำกว่าเกณฑ์ ${formatBaht(thresholdSafe)}`,
    "โอนเข้า: https://telltea-bo.web.app/ledger/?transferIn=1",
  ].join("\n");

  let lineResult;
  try {
    await sendLinePush(notify.channelAccessToken, notify.lineUserId, text);
    lineResult = { ok: true };
  } catch (err) {
    lineResult = { ok: false, error: String(err?.message || err) };
  }

  await db.doc("meta/lowBalanceAlert").set(
    {
      active: true,
      balance,
      threshold: thresholdSafe,
      deferredOutsideHours: false,
      lastLineAt: Date.now(),
      lastLineResult: lineResult,
      flushedByHourly: true,
    },
    { merge: true },
  );
  return { ok: lineResult.ok, line: lineResult, balance, threshold: thresholdSafe };
}

exports.ownerDailyDigestHourly = functions
  .region(REGION)
  .pubsub.schedule("5 * * * *")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const db = getFirestore();
    const deferred = await flushDeferredLowBalanceLine(db);
    console.log("flushDeferredLowBalanceLine", deferred);
    const result = await runDigest({ force: false });
    console.log("ownerDailyDigestHourly", result);
    return null;
  });

exports.ownerLineNotifyTest = functions
  .region(REGION)
  .https.onCall(async (_data, context) => {
    await assertOwnerCallable(context);
    const db = getFirestore();
    const notify = await loadOwnerNotify(db);
    if (!notify.channelAccessToken || !notify.lineUserId) {
      return {
        ok: false,
        detail: "ยังไม่ได้บันทึก Channel access token และ User ID",
      };
    }
    const parts = bangkokParts();
    const text = [
      "TellTea ทดสอบ LINE",
      `เวลา ${bangkokDateKeyFromParts(parts)} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
      "ถ้าเห็นข้อความนี้ แสดงว่าเชื่อม LINE สำเร็จ — แจ้งยอดต่ำและสรุปรายวันจะส่งมาที่นี่",
    ].join("\n");
    try {
      await sendLinePush(notify.channelAccessToken, notify.lineUserId, text);
      return { ok: true, detail: "ส่งข้อความทดสอบไป LINE แล้ว" };
    } catch (err) {
      return { ok: false, detail: String(err?.message || err) };
    }
  });

exports.ownerDailyDigestRunNow = functions
  .region(REGION)
  .https.onCall(async (_data, context) => {
    await assertOwnerCallable(context);
    const result = await runDigest({ force: true });
    return {
      ok: Boolean(result.line?.ok) || Boolean(result.push?.sent),
      detail: result.line?.ok
        ? "ส่งสรุปไป LINE แล้ว"
        : result.line?.error || "ส่งไม่สำเร็จ",
      result,
    };
  });

exports._ownerDailyDigestTestOnly = {
  parseNotify,
  buildDigestText,
  runDigest,
  sendLinePush,
};
