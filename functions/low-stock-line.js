/**
 * Stock low → LINE (instant), for items with alertEnabled + qty ≤ minQty.
 * Triggered on stock/{itemId} write; flush deferred via hourly digest.
 */
const { getFirestore } = require("firebase-admin/firestore");
const {
  bangkokParts,
  hourInWindow,
  loadOwnerNotify,
  sendLinePush,
} = require("./line-owner");

const COOLDOWN_MS = 3 * 60 * 60 * 1000;
const FAIL_RETRY_MS = 45 * 1000;

function itemArmed(data) {
  if (!data || typeof data !== "object") return false;
  const minQty = Number(data.minQty) || 0;
  const qty = Number(data.qty) || 0;
  return data.alertEnabled === true && minQty > 0 && qty <= minQty;
}

function alertRef(db, itemId) {
  return db.doc(`stockLowAlerts/${itemId}`);
}

async function evaluateAndSendStockLowLine(options = {}) {
  const force = Boolean(options.force);
  const db = options.db || getFirestore();
  const itemId = String(options.itemId || "").trim();
  const itemData = options.itemData;

  if (!itemId) {
    return { sent: false, reason: "no_item_id" };
  }

  const notify = await loadOwnerNotify(db);
  let data = itemData;
  if (data == null) {
    const snap = await db.doc(`stock/${itemId}`).get();
    data = snap.exists ? snap.data() : null;
  }

  const parts = bangkokParts();
  const hour = parts.hour;
  const base = {
    itemId,
    hour,
    window: `${notify.instantHourStart}-${notify.instantHourEnd}`,
    lineInstantEnabled: notify.instantLineEnabled !== false,
    stockInstantEnabled: notify.instantStockLowEnabled !== false,
    hasLineCredentials: Boolean(notify.channelAccessToken && notify.lineUserId),
  };

  if (!data) {
    await alertRef(db, itemId).set({ active: false, clearedAt: Date.now() }, { merge: true });
    return { ...base, sent: false, reason: "missing_item" };
  }

  const name = String(data.name || itemId);
  const unit = String(data.unit || "");
  const minQty = Number(data.minQty) || 0;
  const qty = Number(data.qty) || 0;
  const armed = itemArmed(data);

  Object.assign(base, { name, qty, minQty, armed });

  if (!notify.instantLineEnabled || !notify.instantStockLowEnabled) {
    if (!armed) {
      await alertRef(db, itemId).set({ active: false, clearedAt: Date.now(), qty, minQty }, { merge: true });
    }
    return {
      ...base,
      sent: false,
      reason: !notify.instantLineEnabled ? "instant_line_disabled" : "stock_instant_disabled",
    };
  }

  if (!armed) {
    await alertRef(db, itemId).set(
      { active: false, clearedAt: Date.now(), qty, minQty, name },
      { merge: true },
    );
    return { ...base, sent: false, reason: "not_armed" };
  }

  const inWindow = hourInWindow(hour, notify.instantHourStart, notify.instantHourEnd);
  const stateSnap = await alertRef(db, itemId).get();
  const alert = stateSnap.exists ? stateSnap.data() : {};

  if (!force && !inWindow) {
    await alertRef(db, itemId).set(
      {
        active: true,
        qty,
        minQty,
        name,
        deferredOutsideHours: true,
        hour,
        window: `${notify.instantHourStart}-${notify.instantHourEnd}`,
      },
      { merge: true },
    );
    return { ...base, sent: false, reason: "outside_hours", deferred: true };
  }

  if (!notify.channelAccessToken || !notify.lineUserId) {
    await alertRef(db, itemId).set(
      {
        active: true,
        qty,
        minQty,
        name,
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
      await alertRef(db, itemId).set({ active: true, qty, minQty, name }, { merge: true });
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
    "TellTea — คลังต่ำกว่าเกณฑ์",
    `${name}: ${qty} ${unit}`.trim(),
    `ต่ำกว่าหรือเท่าเกณฑ์ ≤ ${minQty}`,
    force ? "(ตรวจด้วยมือจากหน้าตั้งค่า)" : "",
    "เปิดคลัง: https://telltea-bo.web.app/stock/",
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

  await alertRef(db, itemId).set(
    {
      active: true,
      qty,
      minQty,
      name,
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

/** Flush items that were deferred outside hours (or still armed). */
async function flushDeferredStockLowLines(options = {}) {
  const db = options.db || getFirestore();
  const snap = await db.collection("stockLowAlerts").limit(80).get();
  const results = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    if (!data.active && !data.deferredOutsideHours) continue;
    const result = await evaluateAndSendStockLowLine({
      db,
      itemId: docSnap.id,
      force: Boolean(options.force),
    });
    results.push(result);
  }
  return results;
}

module.exports = {
  COOLDOWN_MS,
  FAIL_RETRY_MS,
  itemArmed,
  evaluateAndSendStockLowLine,
  flushDeferredStockLowLines,
};
