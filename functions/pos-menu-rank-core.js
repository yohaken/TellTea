/**
 * Pure bestseller order helpers (no Firebase deps — safe for Node gates).
 */

function normalizeWindowDays(raw) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 7;
  return Math.min(14, Math.max(7, Math.round(n)));
}

function applyBestsellersOrder(categories, items, rank) {
  const catRank = new Map();
  const itemRank = new Map();
  for (const c of (rank && rank.categories) || []) {
    if (c && c.categoryId) catRank.set(c.categoryId, c.rank);
  }
  for (const it of (rank && rank.items) || []) {
    if (it && it.menuItemId) itemRank.set(it.menuItemId, it.rank);
  }
  const rankOf = (map, id) => (map.has(id) ? map.get(id) : 1_000_000);

  const nextCats = [...categories].sort(
    (a, b) =>
      rankOf(catRank, a.id) - rankOf(catRank, b.id) ||
      a.sortOrder - b.sortOrder ||
      String(a.name).localeCompare(String(b.name)),
  );
  const nextItems = [...items].sort(
    (a, b) =>
      rankOf(itemRank, a.id) - rankOf(itemRank, b.id) ||
      a.sortOrder - b.sortOrder ||
      String(a.name).localeCompare(String(b.name)),
  );
  return { categories: nextCats, items: nextItems };
}

module.exports = {
  normalizeWindowDays,
  applyBestsellersOrder,
  DEFAULT_WINDOW_DAYS: 7,
  RANK_STALE_MS: 60 * 60 * 1000,
};
