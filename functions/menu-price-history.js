/**
 * Menu store-price history — Firestore triggers on menuItems / menuOptionGroups.
 * Writes only to menuPriceHistory (never back to menu docs or meta/pos → no loops).
 * Store price only: menuItems.price · menuOptionGroups.options[].priceDelta.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");

const HISTORY_COL = "menuPriceHistory";
const ALREADY_EXISTS = 6;

function normPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function asName(v) {
  return typeof v === "string" ? v.trim().slice(0, 120) : "";
}

/**
 * Who edited: trust priceEditedBy only when stamped in this same write
 * (priceEditedAt === updatedAt); otherwise the value is left over from an earlier edit.
 */
function resolveEditor(after) {
  if (!after) return { source: "script", by: "" };
  const by = typeof after.priceEditedBy === "string" ? after.priceEditedBy : "";
  const stamped =
    by &&
    typeof after.priceEditedAt === "number" &&
    after.priceEditedAt === after.updatedAt;
  if (!stamped) return { source: "script", by: "" };
  if (by.startsWith("npos:")) return { source: "npos", by: by.slice(5).slice(0, 80) };
  if (by.startsWith("pos:")) return { source: "npos", by: by.slice(4).slice(0, 80) };
  if (by.startsWith("boh:")) return { source: "boh", by: by.slice(4).slice(0, 120) };
  return { source: "script", by: by.slice(0, 80) };
}

/** @returns {Array<object>} history rows (without at/eventAt/editor) */
function diffItemPrice(itemId, before, after) {
  if (!before && !after) return [];
  const name = asName(after?.name) || asName(before?.name);
  if (!before) {
    return [{ kind: "item", itemId, name, change: "created", from: null, to: normPrice(after.price) }];
  }
  if (!after) {
    return [{ kind: "item", itemId, name, change: "deleted", from: normPrice(before.price), to: null }];
  }
  const from = normPrice(before.price);
  const to = normPrice(after.price);
  if (from === to) return [];
  return [{ kind: "item", itemId, name, change: "price", from, to }];
}

function choicePriceMap(data) {
  const map = new Map();
  const list = Array.isArray(data?.options) ? data.options : [];
  for (const o of list) {
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !o.id) continue;
    map.set(o.id, { price: normPrice(o.priceDelta), name: asName(o.name) });
  }
  return map;
}

/** Diff by choice id (array order / sortOrder / names never count as price changes). */
function diffGroupPrices(groupId, before, after) {
  if (!before && !after) return [];
  const groupName = asName(after?.name) || asName(before?.name);
  const prev = choicePriceMap(before);
  const next = choicePriceMap(after);
  const rows = [];
  const base = { kind: "option", groupId, name: groupName };
  for (const [choiceId, cur] of next) {
    const old = prev.get(choiceId);
    if (!old) {
      rows.push({
        ...base,
        choiceId,
        choiceName: cur.name,
        change: before ? "added" : "created",
        from: null,
        to: cur.price,
      });
    } else if (old.price !== cur.price) {
      rows.push({ ...base, choiceId, choiceName: cur.name, change: "price", from: old.price, to: cur.price });
    }
  }
  for (const [choiceId, old] of prev) {
    if (next.has(choiceId)) continue;
    rows.push({
      ...base,
      choiceId,
      choiceName: old.name,
      change: after ? "removed" : "deleted",
      from: old.price,
      to: null,
    });
  }
  return rows;
}

async function writeRows(rows, context, after) {
  if (!rows.length) return 0;
  const db = getFirestore();
  const editor = resolveEditor(after);
  const eventAt = Date.parse(context.timestamp) || Date.now();
  const at = typeof after?.updatedAt === "number" && after.updatedAt > 0 ? after.updatedAt : eventAt;
  const batch = db.batch();
  rows.forEach((row, i) => {
    const ref = db.collection(HISTORY_COL).doc(`${context.eventId}_${i}`);
    batch.create(ref, { ...row, ...editor, at, eventAt });
  });
  try {
    await batch.commit();
  } catch (err) {
    // At-least-once delivery: a retried event finds its rows already written.
    if (err && err.code === ALREADY_EXISTS) return 0;
    throw err;
  }
  return rows.length;
}

const onMenuItemPriceWritten = functions
  .region("asia-southeast1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .firestore.document("menuItems/{itemId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    const rows = diffItemPrice(context.params.itemId, before, after);
    await writeRows(rows, context, after);
    return null;
  });

const onMenuOptionGroupPriceWritten = functions
  .region("asia-southeast1")
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .firestore.document("menuOptionGroups/{groupId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    const rows = diffGroupPrices(context.params.groupId, before, after);
    await writeRows(rows, context, after);
    return null;
  });

module.exports = {
  onMenuItemPriceWritten,
  onMenuOptionGroupPriceWritten,
  diffItemPrice,
  diffGroupPrices,
  resolveEditor,
  normPrice,
};
