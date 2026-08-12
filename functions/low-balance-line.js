/**
 * Low-balance → LINE (instant condition alert).
 * Used by Firestore trigger + owner callable for manual check/test.
 */
const { getFirestore } = require("firebase-admin/firestore");
const {
  bangkokParts,
  formatBaht,
  hourInWindow,
  loadOwnerNotify,
  sendLinePush,
} = require("./line-owner");

const COOLDOWN_MS = 3 * 60 * 60 * 1000;
const FAIL_RETRY_MS = 45 * 1000;

async function evaluateAndSendLowBalanceLine(options = {}) {
  const force = Boolean(options.force);
  const db = options.db || getFirestore();
  const balanceOverride = options.balance;

  const [settingsSnap, notify, ledgerSnap, alertSnap] = await Promise.all([
    db.doc("meta/settings").get(),
    loadOwnerNotify(db),
    db.doc("meta/ledger").get(),
    db.doc("meta/lowBalanceAlert").get(),
  ]);

  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const thresholdEnabled = settings.lowBalanceEnabled !== false;
  const lineInstantEnabled = notify.instantLineEnabled !== false;
  const threshold = Number(settings.lowBalanceThreshold);
  const thresholdSafe = Number.isFinite(threshold) ? threshold : 5000;
  const balance =
    balanceOverride != null && Number.isFinite(Number(balanceOverride))
      ? Number(balanceOverride)
      : Number(ledgerSnap.exists ? ledgerSnap.get("balance") : NaN);

  const alertRef = db.doc("meta/lowBalanceAlert");
  const alert = alertSnap.exists ? alertSnap.data() : {};
  const parts = bangkokParts();
  const hour = parts.hour;

  const base = {
    balance: Number.isFinite(balance) ? balance : null,
    threshold: thresholdSafe,
    hour,
    window: `${notify.instantHourStart}-${notify.instantHourEnd}`,
    thresholdEnabled,
    lineInstantEnabled,
    hasLineCredentials: Boolean(notify.channelAccessToken && notify.lineUserId),
  };

  if (!Number.isFinite(balance)) {
    return { ...base, sent: false, reason: "no_balance" };
  }

  if (!thresholdEnabled || !lineInstantEnabled) {
    if (alert.active) {
      await alertRef.set(
        { active: false, clearedAt: Date.now(), balance, threshold: thresholdSafe },
        { merge: true },
      );
    }
    return {
      ...base,
      sent: false,
      reason: !thresholdEnabled ? "threshold_disabled" : "instant_line_disabled",
    };
  }

  if (balance >= thresholdSafe) {
    if (alert.active) {
      await alertRef.set(
        { active: false, clearedAt: Date.now(), balance, threshold: thresholdSafe },
        { merge: true },
      );
    }
    return { ...base, sent: false, reason: "above_threshold" };
  }

  const inWindow = hourInWindow(hour, notify.instantHourStart, notify.instantHourEnd);
  if (!force && !inWindow) {
    await alertRef.set(
      {
        active: true,
        balance,
        threshold: thresholdSafe,
        deferredOutsideHours: true,
        hour,
        window: `${notify.instantHourStart}-${notify.instantHourEnd}`,
      },
      { merge: true },
    );
    return { ...base, sent: false, reason: "outside_hours", deferred: true };
  }

  if (!notify.channelAccessToken || !notify.lineUserId) {
    await alertRef.set(
      {
        active: true,
        balance,
        threshold: thresholdSafe,
        deferredOutsideHours: false,
        lastAttemptAt: Date.now(),
        lastLineResult: { ok: false, error: "missing_line_credentials" },
      },
      { merge: true },
    );
    return { ...base, sent: false, reason: "missing_line_credentials" };
  }

  const lastOkAt = Number(alert.lastLineOkAt || 0);
  const lastAttemptAt = Number(alert.lastAttemptAt || alert.lastLineAt || 0);
  const lastOk = Boolean(alert.lastLineResult?.ok);
  if (!force) {
    if (lastOk && lastOkAt && Date.now() - lastOkAt < COOLDOWN_MS) {
      await alertRef.set({ active: true, balance, threshold: thresholdSafe }, { merge: true });
      return {
        ...base,
        sent: false,
        reason: "cooldown",
        cooldownMsLeft: COOLDOWN_MS - (Date.now() - lastOkAt),
      };
    }
    if (!lastOk && lastAttemptAt && Date.now() - lastAttemptAt < FAIL_RETRY_MS) {
      return {
        ...base,
        sent: false,
        reason: "retry_wait",
        cooldownMsLeft: FAIL_RETRY_MS - (Date.now() - lastAttemptAt),
        lastError: alert.lastLineResult?.error || null,
      };
    }
  }

  const text = [
    "TellTea — เงินคงเหลือต่ำ",
    `คงเหลือ ${formatBaht(balance)}`,
    `ต่ำกว่าเกณฑ์ ${formatBaht(thresholdSafe)}`,
    force ? "(ตรวจด้วยมือจากหน้าตั้งค่า)" : "",
    "โอนเข้า: https://telltea-bo.web.app/ledger/?transferIn=1",
  ]
    .filter(Boolean)
    .join("\n");

  let lineResult;
  try {
    await sendLinePush(notify.channelAccessToken, notify.lineUserId, text);
    lineResult = { ok: true };
  } catch (err) {
    lineResult = { ok: false, error: String(err?.message || err) };
  }

  await alertRef.set(
    {
      active: true,
      balance,
      threshold: thresholdSafe,
      deferredOutsideHours: false,
      lastAttemptAt: Date.now(),
      lastLineAt: Date.now(),
      ...(lineResult.ok ? { lastLineOkAt: Date.now() } : {}),
      lastLineResult: lineResult,
      lastForced: force,
    },
    { merge: true },
  );

  return {
    ...base,
    sent: Boolean(lineResult.ok),
    reason: lineResult.ok ? "sent" : "line_error",
    line: lineResult,
  };
}

module.exports = {
  COOLDOWN_MS,
  FAIL_RETRY_MS,
  evaluateAndSendLowBalanceLine,
};
