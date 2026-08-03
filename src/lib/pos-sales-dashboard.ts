/**
 * Aggregators for BO `/pos-sales` dashboard charts + product cards.
 */
import type { MenuCategory, MenuItem, PosSale, StockMovement } from "./types";
import {
  clampPosDateRange,
  posDateRangeDayCount,
  type PosDateRange,
} from "./pos-sales-report";
import { bangkokDateKey, startOfLocalDay } from "./utils";

export type PosDashDayPoint = {
  dateMs: number;
  dateKey: string;
  /** DD/MM for axis */
  label: string;
  total: number;
  count: number;
};

export type PosDashHourPoint = {
  hour: number;
  label: string;
  total: number;
  count: number;
};

export type PosDashWeekdayPoint = {
  /** 0 = Sun … 6 = Sat (Bangkok) */
  weekday: number;
  label: string;
  total: number;
  count: number;
};

export type PosDashProductRow = {
  menuItemId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  qty: number;
  total: number;
};

export type PosDashCategoryRow = {
  categoryId: string;
  name: string;
  qty: number;
  total: number;
};

export type PosDashProductsSummary = {
  soldMenuCount: number;
  activeMenuCount: number;
  soldMenuPct: number;
  topItem: PosDashProductRow | null;
  topItemPct: number;
  topCategory: PosDashCategoryRow | null;
  topCategoryPct: number;
  topItems: PosDashProductRow[];
  categories: PosDashCategoryRow[];
  lineTotal: number;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function activeSales(sales: PosSale[]): PosSale[] {
  return sales.filter((s) => s.status === "completed");
}

function bangkokHour(ms: number): number {
  if (!ms) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value || "0");
  return Number.isFinite(h) ? h % 24 : 0;
}

/** Sun=0 … Sat=6 for a Bangkok calendar midnight ms. */
export function bangkokWeekday(ms: number): number {
  const key = bangkokDateKey(ms);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return 0;
  // noon UTC avoids DST edge; Bangkok has no DST — use +07 noon
  const day = new Date(`${key}T12:00:00+07:00`).getUTCDay();
  return day;
}

function shortDayLabel(dateMs: number): string {
  const key = bangkokDateKey(dateMs);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

/** Daily net sales for every Bangkok day in range (zeros filled). */
export function summarizePosSalesByDay(
  sales: PosSale[],
  range: PosDateRange,
): PosDashDayPoint[] {
  const { startMs, endMs } = clampPosDateRange(range);
  const map = new Map<string, PosDashDayPoint>();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let ms = startMs; ms <= endMs; ms += dayMs) {
    const dateMs = startOfLocalDay(ms);
    const dateKey = bangkokDateKey(dateMs);
    map.set(dateKey, {
      dateMs,
      dateKey,
      label: shortDayLabel(dateMs),
      total: 0,
      count: 0,
    });
  }
  for (const sale of activeSales(sales)) {
    const dateMs = startOfLocalDay(sale.date || sale.createdAt || 0);
    const dateKey = bangkokDateKey(dateMs);
    const row = map.get(dateKey);
    if (!row) continue;
    row.total = round2(row.total + sale.total);
    row.count += 1;
  }
  return [...map.values()].sort((a, b) => a.dateMs - b.dateMs);
}

/** Hourly totals 00–23 from sale `createdAt` (Bangkok). */
export function summarizePosSalesByHour(sales: PosSale[]): PosDashHourPoint[] {
  const rows: PosDashHourPoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: String(hour).padStart(2, "0"),
    total: 0,
    count: 0,
  }));
  for (const sale of activeSales(sales)) {
    const h = bangkokHour(sale.createdAt || 0);
    rows[h].total = round2(rows[h].total + sale.total);
    rows[h].count += 1;
  }
  return rows;
}

/** Weekday totals Sun–Sat (Bangkok). */
export function summarizePosSalesByWeekday(sales: PosSale[]): PosDashWeekdayPoint[] {
  const rows: PosDashWeekdayPoint[] = WEEKDAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    total: 0,
    count: 0,
  }));
  for (const sale of activeSales(sales)) {
    const dateMs = startOfLocalDay(sale.date || sale.createdAt || 0);
    const wd = bangkokWeekday(dateMs);
    rows[wd].total = round2(rows[wd].total + sale.total);
    rows[wd].count += 1;
  }
  return rows;
}

function pct(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return round2((part / whole) * 100);
}

/** Top products + categories joined to menu catalog. */
export function summarizePosSalesProducts(
  sales: PosSale[],
  items: MenuItem[] = [],
  categories: MenuCategory[] = [],
  topN = 10,
): PosDashProductsSummary {
  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByName = new Map(items.map((i) => [i.name.trim(), i]));
  const activeMenuCount = items.filter((i) => i.active !== false).length;

  const itemMap = new Map<string, PosDashProductRow>();
  const catMap = new Map<string, PosDashCategoryRow>();
  let lineTotal = 0;

  for (const sale of activeSales(sales)) {
    for (const line of sale.lines || []) {
      const amount = round2(line.price * line.qty);
      lineTotal = round2(lineTotal + amount);
      const catalog =
        (line.menuItemId && itemById.get(line.menuItemId)) ||
        itemByName.get((line.name || "").trim());
      const categoryId = catalog?.categoryId || "";
      const categoryName = (categoryId && catById.get(categoryId)) || "อื่นๆ";
      const key = line.menuItemId || line.name || "?";
      const row =
        itemMap.get(key) ||
        ({
          menuItemId: line.menuItemId || key,
          name: line.name || "—",
          categoryId,
          categoryName,
          qty: 0,
          total: 0,
        } satisfies PosDashProductRow);
      row.qty += line.qty;
      row.total = round2(row.total + amount);
      if (catalog?.name) row.name = catalog.name;
      row.categoryId = categoryId;
      row.categoryName = categoryName;
      itemMap.set(key, row);

      const catKey = categoryId || "__other__";
      const cat =
        catMap.get(catKey) ||
        ({
          categoryId: catKey,
          name: categoryName,
          qty: 0,
          total: 0,
        } satisfies PosDashCategoryRow);
      cat.qty += line.qty;
      cat.total = round2(cat.total + amount);
      catMap.set(catKey, cat);
    }
  }

  const topItems = [...itemMap.values()]
    .sort((a, b) => b.total - a.total || b.qty - a.qty)
    .slice(0, topN);
  const categoryRows = [...catMap.values()].sort(
    (a, b) => b.total - a.total || b.qty - a.qty,
  );
  const topItem = topItems[0] || null;
  const topCategory = categoryRows[0] || null;

  const soldMenuCount = itemMap.size;
  const soldMenuPctRaw = pct(soldMenuCount, activeMenuCount || soldMenuCount || 1);
  return {
    soldMenuCount,
    activeMenuCount,
    /** Cap at 100 — sold keys may include discontinued / uncatalogued items. */
    soldMenuPct: Math.min(100, soldMenuPctRaw),
    topItem,
    topItemPct: topItem ? pct(topItem.total, lineTotal) : 0,
    topCategory,
    topCategoryPct: topCategory ? pct(topCategory.total, lineTotal) : 0,
    topItems,
    categories: categoryRows,
    lineTotal,
  };
}

export function averagePerBill(netTotal: number, billCount: number): number {
  if (!(billCount > 0)) return 0;
  return round2(netTotal / billCount);
}

export function averagePerDay(netTotal: number, range: PosDateRange): number {
  const days = Math.max(1, posDateRangeDayCount(range));
  return round2(netTotal / days);
}

export type PosDashStockSummary = {
  inCount: number;
  inValue: number;
  outCount: number;
  outValue: number;
  adjustCount: number;
  adjustValue: number;
  /** OUT + ADJUST combined for the “เบิก/ปรับ” panel */
  outAdjustCount: number;
  outAdjustValue: number;
};

/** Filter movements to an inclusive Bangkok date range. */
export function filterStockMovementsInRange(
  movements: StockMovement[],
  range: PosDateRange,
): StockMovement[] {
  const { startMs, endMs } = clampPosDateRange(range);
  return movements.filter((m) => {
    const day = startOfLocalDay(m.date || m.createdAt || 0);
    return day >= startMs && day <= endMs;
  });
}

/**
 * Stock IN / OUT+ADJUST for dashboard.
 * Value = quantity × unitCost (from `stockCosts`); missing cost → 0 baht but count still rises.
 */
export function summarizeStockMovementsForDashboard(
  movements: StockMovement[],
  range: PosDateRange,
  costByItemId: Map<string, number> = new Map(),
): PosDashStockSummary {
  const inRange = filterStockMovementsInRange(movements, range);
  let inCount = 0;
  let inValue = 0;
  let outCount = 0;
  let outValue = 0;
  let adjustCount = 0;
  let adjustValue = 0;

  for (const m of inRange) {
    const cost = costByItemId.get(m.itemId) || 0;
    const qty = Math.max(0, m.quantity);
    if (m.type === "IN") {
      inCount += 1;
      inValue = round2(inValue + round2(qty * cost));
    } else if (m.type === "OUT") {
      outCount += 1;
      outValue = round2(outValue + round2(qty * cost));
    } else if (m.type === "ADJUST") {
      adjustCount += 1;
      // Only downward adjusts count toward “เบิก/ปรับ” value (upward ≠ issue).
      const before = m.qtyBefore;
      const after = m.qtyAfter;
      if (
        typeof before === "number" &&
        typeof after === "number" &&
        Number.isFinite(before) &&
        Number.isFinite(after) &&
        after < before
      ) {
        adjustValue = round2(adjustValue + round2((before - after) * cost));
      }
    }
  }

  return {
    inCount,
    inValue,
    outCount,
    outValue,
    adjustCount,
    adjustValue,
    outAdjustCount: outCount + adjustCount,
    outAdjustValue: round2(outValue + adjustValue),
  };
}

export { WEEKDAY_LABELS };
