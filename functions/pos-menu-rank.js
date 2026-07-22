/**
 * Cloud bestseller rank — aggregate posSales → meta/posMenuRank.
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  applyBestsellersOrder,
  normalizeWindowDays,
  DEFAULT_WINDOW_DAYS,
  RANK_STALE_MS,
} = require("./pos-menu-rank-core");

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {number} [windowDays]
 */
async function recomputePosMenuRank(db, windowDays) {
  const days = normalizeWindowDays(windowDays);
  const now = Date.now();
  const since = now - days * 86_400_000;

  const [salesSnap, itemsSnap, posSnap] = await Promise.all([
    db.collection("posSales").where("createdAt", ">=", since).get(),
    db.collection("menuItems").get(),
    db.doc("meta/pos").get(),
  ]);

  const categoryIdByItem = {};
  for (const d of itemsSnap.docs) {
    const x = d.data() || {};
    if (typeof x.categoryId === "string" && x.categoryId) {
      categoryIdByItem[d.id] = x.categoryId;
    }
  }

  const itemQty = new Map();
  for (const d of salesSnap.docs) {
    const x = d.data() || {};
    if (x.status && x.status !== "completed") continue;
    const lines = Array.isArray(x.lines) ? x.lines : [];
    for (const line of lines) {
      if (!line) continue;
      const id =
        typeof line.menuItemId === "string" && line.menuItemId.trim()
          ? line.menuItemId.trim()
          : typeof line.name === "string"
            ? line.name.trim()
            : "";
      if (!id) continue;
      const qty = Math.max(0, Number(line.qty) || 0);
      if (!qty) continue;
      const categoryId =
        (typeof line.categoryId === "string" && line.categoryId) ||
        categoryIdByItem[id] ||
        "";
      const prev = itemQty.get(id) || { qty: 0, categoryId };
      prev.qty += qty;
      if (!prev.categoryId && categoryId) prev.categoryId = categoryId;
      itemQty.set(id, prev);
    }
  }

  const items = [...itemQty.entries()]
    .map(([menuItemId, v]) => ({
      menuItemId,
      categoryId: v.categoryId || "",
      qty: v.qty,
      score: v.qty,
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score || a.menuItemId.localeCompare(b.menuItemId))
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const catScore = new Map();
  for (const it of items) {
    if (!it.categoryId) continue;
    catScore.set(it.categoryId, (catScore.get(it.categoryId) || 0) + it.qty);
  }
  const categories = [...catScore.entries()]
    .map(([categoryId, score]) => ({ categoryId, score, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.categoryId.localeCompare(b.categoryId))
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const pos = posSnap.exists ? posSnap.data() || {} : {};
  const menuArrangeMode = pos.menuArrangeMode === "bestsellers" ? "bestsellers" : "fix";
  const configuredDays = normalizeWindowDays(
    typeof pos.bestsellerWindowDays === "number" ? pos.bestsellerWindowDays : days,
  );

  const payload = {
    windowDays: configuredDays,
    computedAt: now,
    menuArrangeMode,
    categories,
    items,
    itemCount: items.length,
    categoryCount: categories.length,
  };

  await db.doc("meta/posMenuRank").set(payload, { merge: true });
  return payload;
}

async function loadOrRefreshRank(db, opts = {}) {
  const force = opts.force === true;
  const posSnap = await db.doc("meta/pos").get();
  const pos = posSnap.exists ? posSnap.data() || {} : {};
  const windowDays = normalizeWindowDays(
    typeof pos.bestsellerWindowDays === "number" ? pos.bestsellerWindowDays : DEFAULT_WINDOW_DAYS,
  );
  const menuArrangeMode = pos.menuArrangeMode === "bestsellers" ? "bestsellers" : "fix";

  const rankRef = db.doc("meta/posMenuRank");
  const rankSnap = await rankRef.get();
  const existing = rankSnap.exists ? rankSnap.data() || {} : null;
  const computedAt = existing && typeof existing.computedAt === "number" ? existing.computedAt : 0;
  const stale = !existing || Date.now() - computedAt > RANK_STALE_MS;

  let table = existing;
  if (force || stale || !existing) {
    try {
      table = await recomputePosMenuRank(db, windowDays);
    } catch (err) {
      console.error("loadOrRefreshRank recompute", err);
      table = existing || {
        windowDays,
        computedAt: 0,
        categories: [],
        items: [],
      };
    }
  }

  return {
    menuArrangeMode,
    windowDays,
    rank: table
      ? {
          windowDays: normalizeWindowDays(table.windowDays || windowDays),
          computedAt: typeof table.computedAt === "number" ? table.computedAt : 0,
          categories: Array.isArray(table.categories) ? table.categories : [],
          items: Array.isArray(table.items) ? table.items : [],
        }
      : { windowDays, computedAt: 0, categories: [], items: [] },
  };
}

exports.recomputePosMenuRank = recomputePosMenuRank;
exports.loadOrRefreshRank = loadOrRefreshRank;
exports.applyBestsellersOrder = applyBestsellersOrder;
exports.DEFAULT_WINDOW_DAYS = DEFAULT_WINDOW_DAYS;
exports.RANK_STALE_MS = RANK_STALE_MS;

/** Manual / cron refresh */
exports.posRecomputeMenuRank = functions
  .region("asia-southeast1")
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      const db = getFirestore();
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const table = await recomputePosMenuRank(db, body.windowDays);
      res.status(200).json({ ok: true, ...table });
    } catch (err) {
      console.error("posRecomputeMenuRank", err);
      res.status(500).json({ ok: false, error: "rank_failed" });
    }
  });

/** Daily warm recompute (Asia/Bangkok morning) */
exports.posMenuRankDaily = functions
  .region("asia-southeast1")
  .pubsub.schedule("15 4 * * *")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const db = getFirestore();
    await recomputePosMenuRank(db);
    return null;
  });
