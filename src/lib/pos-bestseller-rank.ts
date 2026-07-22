/**
 * Bestseller ranking helpers — shared by web POS sell + BO settings.
 * Mode: fix | bestsellers. Window: 7 days (extendable to 14 via settings).
 */

export type MenuArrangeMode = "fix" | "bestsellers";

export type PosMenuRankItem = {
  menuItemId: string;
  categoryId: string;
  qty: number;
  score: number;
  rank: number;
};

export type PosMenuRankCategory = {
  categoryId: string;
  score: number;
  rank: number;
};

export type PosMenuRankTable = {
  windowDays: number;
  computedAt: number;
  categories: PosMenuRankCategory[];
  items: PosMenuRankItem[];
};

export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 14;
export const RANK_STALE_MS = 60 * 60 * 1000; // 1h

export function normalizeMenuArrangeMode(raw: unknown): MenuArrangeMode {
  return raw === "bestsellers" ? "bestsellers" : "fix";
}

export function normalizeWindowDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(7, Math.round(n)));
}

/** Lower rank number = better (1 = top). Missing → large. */
export function rankValue(
  map: Map<string, number> | Record<string, number> | undefined,
  id: string,
): number {
  if (!map || !id) return 1_000_000;
  if (map instanceof Map) {
    const v = map.get(id);
    return typeof v === "number" ? v : 1_000_000;
  }
  const v = map[id];
  return typeof v === "number" ? v : 1_000_000;
}

export function buildRankMaps(table: PosMenuRankTable | null | undefined): {
  categoryRank: Map<string, number>;
  itemRank: Map<string, number>;
} {
  const categoryRank = new Map<string, number>();
  const itemRank = new Map<string, number>();
  if (!table) return { categoryRank, itemRank };
  for (const c of table.categories || []) {
    if (c?.categoryId) categoryRank.set(c.categoryId, c.rank);
  }
  for (const it of table.items || []) {
    if (it?.menuItemId) itemRank.set(it.menuItemId, it.rank);
  }
  return { categoryRank, itemRank };
}

export function sortCategoriesByRank<T extends { id: string; sortOrder: number; name: string }>(
  rows: T[],
  categoryRank: Map<string, number>,
): T[] {
  return [...rows].sort(
    (a, b) =>
      rankValue(categoryRank, a.id) - rankValue(categoryRank, b.id) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "th"),
  );
}

export function sortItemsByRank<
  T extends { id: string; sortOrder: number; name: string; active?: boolean },
>(rows: T[], itemRank: Map<string, number>): T[] {
  return [...rows].sort((a, b) => {
    if (a.active !== b.active) {
      if (a.active === false) return 1;
      if (b.active === false) return -1;
    }
    return (
      rankValue(itemRank, a.id) - rankValue(itemRank, b.id) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "th")
    );
  });
}

type SaleLineLike = {
  menuItemId?: string;
  name?: string;
  qty?: number;
  categoryId?: string;
};

type SaleLike = {
  status?: string;
  createdAt?: number;
  lines?: SaleLineLike[];
};

/**
 * Aggregate completed sales into a rank table.
 * categoryIdByItem: menuItemId → categoryId (from menu catalog).
 */
export function computeRankTable(input: {
  sales: SaleLike[];
  windowDays?: number;
  now?: number;
  categoryIdByItem?: Record<string, string> | Map<string, string>;
}): PosMenuRankTable {
  const windowDays = normalizeWindowDays(input.windowDays ?? DEFAULT_WINDOW_DAYS);
  const now = input.now ?? Date.now();
  const since = now - windowDays * 86_400_000;
  const catLookup = input.categoryIdByItem || {};

  const itemQty = new Map<string, { qty: number; categoryId: string }>();
  for (const sale of input.sales) {
    if (sale.status && sale.status !== "completed") continue;
    const at = typeof sale.createdAt === "number" ? sale.createdAt : 0;
    if (at && at < since) continue;
    for (const line of sale.lines || []) {
      const id = (line.menuItemId || line.name || "").trim();
      if (!id) continue;
      const qty = Math.max(0, Number(line.qty) || 0);
      if (!qty) continue;
      let categoryId = (line.categoryId || "").trim();
      if (!categoryId) {
        categoryId =
          catLookup instanceof Map
            ? catLookup.get(id) || ""
            : typeof catLookup[id] === "string"
              ? catLookup[id]
              : "";
      }
      const prev = itemQty.get(id) || { qty: 0, categoryId };
      prev.qty += qty;
      if (!prev.categoryId && categoryId) prev.categoryId = categoryId;
      itemQty.set(id, prev);
    }
  }

  const itemsRaw = [...itemQty.entries()]
    .map(([menuItemId, v]) => ({
      menuItemId,
      categoryId: v.categoryId,
      qty: v.qty,
      score: v.qty,
    }))
    .sort((a, b) => b.score - a.score || a.menuItemId.localeCompare(b.menuItemId));

  const items: PosMenuRankItem[] = itemsRaw.map((row, i) => ({
    ...row,
    rank: i + 1,
  }));

  const catScore = new Map<string, number>();
  for (const it of items) {
    if (!it.categoryId) continue;
    catScore.set(it.categoryId, (catScore.get(it.categoryId) || 0) + it.qty);
  }
  const categories: PosMenuRankCategory[] = [...catScore.entries()]
    .map(([categoryId, score]) => ({ categoryId, score, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.categoryId.localeCompare(b.categoryId))
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return { windowDays, computedAt: now, categories, items };
}

export function isRankStale(table: PosMenuRankTable | null | undefined, now = Date.now()): boolean {
  if (!table || !table.computedAt) return true;
  return now - table.computedAt > RANK_STALE_MS;
}
