/**
 * Aggregators for BO `/pos-sales` dashboard charts + product cards.
 */
import type { ShopMember } from "./members";
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
  /** Every sold product, same order as topItems. */
  allItems: PosDashProductRow[];
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

/** Bangkok is fixed UTC+7 (no DST) — arithmetic avoids an Intl formatter per line. */
export function bangkokHour(ms: number): number {
  if (!ms || !Number.isFinite(ms)) return 0;
  const h = Math.floor(ms / 3_600_000 + 7) % 24;
  return h < 0 ? h + 24 : h;
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

export type PosDashTimeBandId = "morning" | "evening" | "late";

/** Same windows as OT shifts (getCurrentShiftId): เช้า 07–17 · เย็น 17–24 · ดึก 00–07. */
export const POS_DASH_TIME_BANDS: {
  id: PosDashTimeBandId;
  label: string;
  range: string;
  hours: number[];
}[] = [
  { id: "morning", label: "เช้า", range: "07:00–17:00", hours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16] },
  { id: "evening", label: "เย็น", range: "17:00–24:00", hours: [17, 18, 19, 20, 21, 22, 23] },
  { id: "late", label: "ดึก", range: "00:00–07:00", hours: [0, 1, 2, 3, 4, 5, 6] },
];

export type PosDashTimeRow = {
  total: number;
  bills: number;
  units: number;
  /** Share of grand total baht (0–100). */
  pct: number;
  avgBill: number;
  /** Baht per day in range (0 when dayCount unknown). */
  perDay: number;
};

export type PosDashTimeBandRow = PosDashTimeRow & {
  id: PosDashTimeBandId;
  label: string;
  range: string;
  /** Busiest hour in this band by baht; null when no sales. */
  peakHour: number | null;
};

export type PosDashHourTotalRow = PosDashTimeRow & { hour: number; label: string };

export type PosDashTimeTotals = {
  bands: PosDashTimeBandRow[];
  hours: PosDashHourTotalRow[];
  grand: PosDashTimeRow;
};

/** Net bill totals grouped by shift band and by hour (bill close time, Bangkok). */
export function summarizePosSalesByTimeBand(sales: PosSale[], dayCount = 0): PosDashTimeTotals {
  const hourAcc = Array.from({ length: 24 }, () => ({ total: 0, bills: 0, units: 0 }));
  for (const sale of activeSales(sales)) {
    const h = bangkokHour(sale.createdAt || 0);
    const acc = hourAcc[h];
    acc.total = round2(acc.total + (Number(sale.total) || 0));
    acc.bills += 1;
    for (const line of sale.lines || []) {
      const n = Number(line.qty);
      if (Number.isFinite(n) && n > 0) acc.units += n;
    }
  }
  const grandTotal = round2(hourAcc.reduce((s, a) => s + a.total, 0));
  const finish = (a: { total: number; bills: number; units: number }): PosDashTimeRow => ({
    total: a.total,
    bills: a.bills,
    units: a.units,
    pct: pct(a.total, grandTotal),
    avgBill: a.bills > 0 ? round2(a.total / a.bills) : 0,
    perDay: dayCount > 0 ? round2(a.total / dayCount) : 0,
  });

  const hours = hourAcc.map((a, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    ...finish(a),
  }));
  const bands = POS_DASH_TIME_BANDS.map((b) => {
    const sum = { total: 0, bills: 0, units: 0 };
    let peakHour: number | null = null;
    for (const h of b.hours) {
      const a = hourAcc[h];
      sum.total = round2(sum.total + a.total);
      sum.bills += a.bills;
      sum.units += a.units;
      if (a.total > 0 && (peakHour === null || a.total > hourAcc[peakHour].total)) peakHour = h;
    }
    return { id: b.id, label: b.label, range: b.range, peakHour, ...finish(sum) };
  });
  const grand = finish({
    total: grandTotal,
    bills: hourAcc.reduce((s, a) => s + a.bills, 0),
    units: hourAcc.reduce((s, a) => s + a.units, 0),
  });
  return { bands, hours, grand };
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

/** Thai weekday names, index = JS getUTCDay (0 = Sun). */
export const POS_DASH_WEEKDAY_TH = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
] as const;
export const POS_DASH_WEEKDAY_TH_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."] as const;
/** Display order Mon → Sun. */
export const POS_DASH_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type PosDashWeekdayDay = {
  dateKey: string;
  /** DD/MM */
  label: string;
  total: number;
  bills: number;
  /** Today — day not finished yet. */
  isToday: boolean;
};

export type PosDashWeekdayAvgRow = {
  weekday: number;
  label: string;
  short: string;
  /** Calendar days of this weekday inside the range (up to today). */
  days: number;
  daysWithSales: number;
  dates: PosDashWeekdayDay[];
  total: number;
  bills: number;
  /** total ÷ days */
  avgPerDay: number;
  billsPerDay: number;
  avgBill: number;
  /** avgPerDay vs mean of all weekday averages (100 = normal). */
  index: number;
};

export type PosDashWeekdayAvgSummary = {
  rows: PosDashWeekdayAvgRow[];
  totalDays: number;
  total: number;
  bills: number;
  avgPerDay: number;
  /** Weekday counts differ (e.g. Mon ×5, Sun ×4) — totals alone are misleading. */
  unequalDays: boolean;
  /** Days after today were dropped from the range. */
  cappedAtToday: boolean;
  /** Today (unfinished) left out so it doesn't drag its weekday down. */
  excludedToday: boolean;
};

/**
 * Weekday sales normalised by how many of each weekday fall in the range.
 * Day bucket = bill business day (`sale.date`); `band` filters by bill close hour.
 */
export function summarizePosSalesByWeekdayAvg(
  sales: PosSale[],
  range: PosDateRange,
  opts: { band?: PosDashTimeBandId | "all"; nowMs?: number } = {},
): PosDashWeekdayAvgSummary {
  const { startMs, endMs } = clampPosDateRange(range);
  const todayMs = startOfLocalDay(opts.nowMs ?? Date.now());
  const excludedToday = endMs >= todayMs && startMs < todayMs;
  const lastMs = excludedToday ? startOfLocalDay(todayMs - 12 * 3_600_000) : Math.min(endMs, todayMs);
  const todayKey = bangkokDateKey(todayMs);
  const bandHours =
    opts.band && opts.band !== "all"
      ? new Set(POS_DASH_TIME_BANDS.find((b) => b.id === opts.band)?.hours ?? [])
      : null;

  const byKey = new Map<string, PosDashWeekdayDay & { weekday: number }>();
  for (let ms = startMs; ms <= lastMs; ms = startOfLocalDay(ms + 36 * 3_600_000)) {
    const dateKey = bangkokDateKey(ms);
    byKey.set(dateKey, {
      dateKey,
      label: shortDayLabel(ms),
      total: 0,
      bills: 0,
      isToday: dateKey === todayKey,
      weekday: bangkokWeekday(ms),
    });
  }
  for (const sale of activeSales(sales)) {
    if (bandHours && !bandHours.has(bangkokHour(sale.createdAt || 0))) continue;
    const day = byKey.get(bangkokDateKey(startOfLocalDay(sale.date || sale.createdAt || 0)));
    if (!day) continue;
    day.total = round2(day.total + (Number(sale.total) || 0));
    day.bills += 1;
  }

  const rows = POS_DASH_WEEKDAY_ORDER.map((weekday) => {
    const dates: PosDashWeekdayDay[] = [...byKey.values()]
      .filter((d) => d.weekday === weekday)
      .map((d) => ({
        dateKey: d.dateKey,
        label: d.label,
        total: d.total,
        bills: d.bills,
        isToday: d.isToday,
      }));
    const total = round2(dates.reduce((s, d) => s + d.total, 0));
    const bills = dates.reduce((s, d) => s + d.bills, 0);
    const days = dates.length;
    return {
      weekday,
      label: POS_DASH_WEEKDAY_TH[weekday],
      short: POS_DASH_WEEKDAY_TH_SHORT[weekday],
      days,
      daysWithSales: dates.filter((d) => d.bills > 0).length,
      dates,
      total,
      bills,
      avgPerDay: days > 0 ? round2(total / days) : 0,
      billsPerDay: days > 0 ? round2(bills / days) : 0,
      avgBill: bills > 0 ? round2(total / bills) : 0,
      index: 0,
    };
  });
  const present = rows.filter((r) => r.days > 0);
  const meanAvg = present.length
    ? present.reduce((s, r) => s + r.avgPerDay, 0) / present.length
    : 0;
  for (const r of rows) r.index = meanAvg > 0 && r.days > 0 ? Math.round((r.avgPerDay / meanAvg) * 100) : 0;

  const totalDays = byKey.size;
  const total = round2(rows.reduce((s, r) => s + r.total, 0));
  const counts = new Set(present.map((r) => r.days));
  return {
    rows,
    totalDays,
    total,
    bills: rows.reduce((s, r) => s + r.bills, 0),
    avgPerDay: totalDays > 0 ? round2(total / totalDays) : 0,
    unequalDays: counts.size > 1 || (present.length > 0 && present.length < 7),
    cappedAtToday: endMs > todayMs,
    excludedToday,
  };
}

function pct(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return round2((part / whole) * 100);
}

type SaleLine = NonNullable<PosSale["lines"]>[number];

/** One product key per menu item — lines without menuItemId merge by catalog name. */
function createLineProductResolver(items: MenuItem[], categories: MenuCategory[]) {
  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByName = new Map(items.map((i) => [i.name.trim(), i]));
  return (line: SaleLine) => {
    const lineName = (line.name || "").trim();
    const catalog =
      (line.menuItemId && itemById.get(line.menuItemId)) || itemByName.get(lineName);
    const categoryId = catalog?.categoryId || "";
    return {
      key: catalog?.id || line.menuItemId || lineName || "?",
      name: catalog?.name || line.name || "—",
      categoryId,
      categoryName: (categoryId && catById.get(categoryId)) || "อื่นๆ",
    };
  };
}

export type PosDashHourRow = {
  key: string;
  name: string;
  /** Product rows: owning category. Category rows: same as key. */
  categoryId: string;
  categoryName: string;
  qty: number;
  /** Units sold per Bangkok hour 0–23. */
  byHour: number[];
  peakHour: number;
  /** Share of row qty in its peak hour (0–100). */
  peakPct: number;
};

export type PosDashProductHours = {
  products: PosDashHourRow[];
  categories: PosDashHourRow[];
  /** Inclusive hour span with any sale; null when no sales. */
  firstHour: number | null;
  lastHour: number | null;
};

function finishHourRow(row: PosDashHourRow): PosDashHourRow {
  let peak = 0;
  for (let h = 1; h < 24; h += 1) if (row.byHour[h] > row.byHour[peak]) peak = h;
  row.peakHour = peak;
  row.peakPct = pct(row.byHour[peak], row.qty);
  return row;
}

/** Units per product / category per hour (bill close time, Bangkok). */
export function summarizePosProductHours(
  sales: PosSale[],
  items: MenuItem[] = [],
  categories: MenuCategory[] = [],
): PosDashProductHours {
  const resolve = createLineProductResolver(items, categories);
  const prodMap = new Map<string, PosDashHourRow>();
  const catMap = new Map<string, PosDashHourRow>();
  let firstHour: number | null = null;
  let lastHour: number | null = null;

  const bump = (
    map: Map<string, PosDashHourRow>,
    key: string,
    name: string,
    categoryId: string,
    categoryName: string,
    h: number,
    qty: number,
  ) => {
    const row =
      map.get(key) ||
      ({
        key,
        name,
        categoryId,
        categoryName,
        qty: 0,
        byHour: new Array<number>(24).fill(0),
        peakHour: 0,
        peakPct: 0,
      } satisfies PosDashHourRow);
    row.name = name;
    row.qty += qty;
    row.byHour[h] += qty;
    map.set(key, row);
  };

  for (const sale of activeSales(sales)) {
    const h = bangkokHour(sale.createdAt || 0);
    for (const line of sale.lines || []) {
      const qty = Number(line.qty) || 0;
      if (qty <= 0) continue;
      const p = resolve(line);
      bump(prodMap, p.key, p.name, p.categoryId, p.categoryName, h, qty);
      const catKey = p.categoryId || "__other__";
      bump(catMap, catKey, p.categoryName, catKey, p.categoryName, h, qty);
      if (firstHour === null || h < firstHour) firstHour = h;
      if (lastHour === null || h > lastHour) lastHour = h;
    }
  }

  const sortRows = (map: Map<string, PosDashHourRow>) =>
    [...map.values()]
      .map(finishHourRow)
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "th"));

  return {
    products: sortRows(prodMap),
    categories: sortRows(catMap),
    firstHour,
    lastHour,
  };
}

export type PosDashOptionRow = {
  key: string;
  groupName: string;
  name: string;
  paid: boolean;
  /** Times picked (a choice picked ×2 on one cup counts 2). */
  qty: number;
  /** Cups/units carrying this choice at least once. */
  cups: number;
  /** Paid only: Σ priceDelta × picks. */
  revenue: number;
  /** Paid only: revenue / qty. */
  avgPrice: number;
  /** Share of all picks in the same option group (0–100). */
  groupSharePct: number;
  /** cups / all units sold (0–100). */
  attachPct: number;
};

export type PosDashOptionsSummary = {
  paid: PosDashOptionRow[];
  free: PosDashOptionRow[];
  /** Option group names, most-picked first. */
  groups: string[];
  totalCups: number;
  cupsWithOption: number;
  cupsWithPaidOption: number;
  paidRevenue: number;
  paidPicks: number;
  freePicks: number;
};

/** "ไม่เพิ่ม…" = customer declined the group — real data, but crowds the ranking. */
export function isNoneOptionChoice(name: string): boolean {
  return /^ไม่เพิ่ม/.test((name || "").trim());
}

/** Popular modifiers from sale lines — paid (priceDelta > 0) vs free, ranked by picks. */
export function summarizePosSaleOptions(sales: PosSale[]): PosDashOptionsSummary {
  const rows = new Map<string, PosDashOptionRow>();
  const groupPicks = new Map<string, number>();
  let totalCups = 0;
  let cupsWithOption = 0;
  let cupsWithPaidOption = 0;
  let paidRevenue = 0;
  let paidPicks = 0;
  let freePicks = 0;

  for (const sale of activeSales(sales)) {
    for (const line of sale.lines || []) {
      const units = Number(line.qty) || 0;
      if (units <= 0) continue;
      totalCups += units;
      let anyOption = false;
      let anyPaid = false;
      const seenOnLine = new Set<string>();
      for (const group of line.options || []) {
        const groupName = (group.groupName || "").trim() || "ตัวเลือก";
        for (const choice of group.choices || []) {
          const name = (choice.name || "").trim();
          if (!name) continue;
          const delta = Math.max(0, Number(choice.priceDelta) || 0);
          const paid = delta > 0;
          const key = `${paid ? "p" : "f"}|${groupName}|${name}`;
          const row =
            rows.get(key) ||
            ({
              key,
              groupName,
              name,
              paid,
              qty: 0,
              cups: 0,
              revenue: 0,
              avgPrice: 0,
              groupSharePct: 0,
              attachPct: 0,
            } satisfies PosDashOptionRow);
          row.qty += units;
          if (!seenOnLine.has(key)) {
            seenOnLine.add(key);
            row.cups += units;
          }
          if (paid) {
            const amt = round2(delta * units);
            row.revenue = round2(row.revenue + amt);
            paidRevenue = round2(paidRevenue + amt);
            paidPicks += units;
            anyPaid = true;
          } else {
            freePicks += units;
          }
          rows.set(key, row);
          groupPicks.set(groupName, (groupPicks.get(groupName) || 0) + units);
          anyOption = true;
        }
      }
      if (anyOption) cupsWithOption += units;
      if (anyPaid) cupsWithPaidOption += units;
    }
  }

  const all = [...rows.values()].map((r) => {
    r.avgPrice = r.qty > 0 ? round2(r.revenue / r.qty) : 0;
    r.groupSharePct = pct(r.qty, groupPicks.get(r.groupName) || 0);
    r.attachPct = pct(r.cups, totalCups);
    return r;
  });
  const sortRows = (list: PosDashOptionRow[]) =>
    list.sort(
      (a, b) =>
        b.qty - a.qty ||
        b.revenue - a.revenue ||
        a.groupName.localeCompare(b.groupName, "th") ||
        a.name.localeCompare(b.name, "th"),
    );

  return {
    paid: sortRows(all.filter((r) => r.paid)),
    free: sortRows(all.filter((r) => !r.paid)),
    groups: [...groupPicks.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"))
      .map(([g]) => g),
    totalCups,
    cupsWithOption,
    cupsWithPaidOption,
    paidRevenue,
    paidPicks,
    freePicks,
  };
}

/** Top products + categories joined to menu catalog. */
export function summarizePosSalesProducts(
  sales: PosSale[],
  items: MenuItem[] = [],
  categories: MenuCategory[] = [],
  topN = 10,
): PosDashProductsSummary {
  const resolve = createLineProductResolver(items, categories);
  const activeMenuCount = items.filter((i) => i.active !== false).length;

  const itemMap = new Map<string, PosDashProductRow>();
  const catMap = new Map<string, PosDashCategoryRow>();
  let lineTotal = 0;

  for (const sale of activeSales(sales)) {
    for (const line of sale.lines || []) {
      const amount = round2(line.price * line.qty);
      lineTotal = round2(lineTotal + amount);
      const { key, name, categoryId, categoryName } = resolve(line);
      const row =
        itemMap.get(key) ||
        ({
          menuItemId: key,
          name,
          categoryId,
          categoryName,
          qty: 0,
          total: 0,
        } satisfies PosDashProductRow);
      row.qty += line.qty;
      row.total = round2(row.total + amount);
      row.name = name;
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

  const allItems = [...itemMap.values()].sort(
    (a, b) => b.total - a.total || b.qty - a.qty || a.name.localeCompare(b.name, "th"),
  );
  const topItems = allItems.slice(0, topN);
  const categoryRows = [...catMap.values()].sort(
    (a, b) => b.total - a.total || b.qty - a.qty,
  );
  const topItem = allItems[0] || null;
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
    allItems,
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

/** รวมจำนวนชิ้น (หน่วยขาย) จากบรรทัดบิลที่ปิดแล้ว — หนึ่งบิลอาจหลายชิ้น */
export function countSaleUnits(sales: PosSale[]): number {
  let qty = 0;
  for (const sale of activeSales(sales)) {
    for (const line of sale.lines || []) {
      const n = Number(line.qty);
      if (Number.isFinite(n) && n > 0) qty += n;
    }
  }
  return qty;
}

/** รายได้เฉลี่ยต่อชิ้นหน้าร้าน = ยอดสุทธิ ÷ จำนวนชิ้น */
export function averagePerUnit(netTotal: number, unitCount: number): number {
  if (!(unitCount > 0)) return 0;
  return round2(netTotal / unitCount);
}

/** เฉลี่ยชิ้นต่อบิล */
export function averageUnitsPerBill(unitCount: number, billCount: number): number {
  if (!(billCount > 0)) return 0;
  return round2(unitCount / billCount);
}

export type PosDashMemberDayPoint = {
  dateMs: number;
  dateKey: string;
  label: string;
  /** สมัครใหม่ในวันนั้น */
  signups: number;
  /** สมาชิกสะสม ณ สิ้นวัน (ไม่นับที่ลบแล้ว) */
  cumulative: number;
};

export type PosDashMembersSummary = {
  /** สมาชิกสะสมก่อนวันแรกของช่วง */
  cumulativeStart: number;
  /** สมาชิกสะสมปลายช่วง */
  cumulativeEnd: number;
  /** สมัครใหม่ในช่วง */
  signupsInRange: number;
  /** cumulativeEnd - cumulativeStart */
  netChange: number;
  byDay: PosDashMemberDayPoint[];
};

/** Exclusive end bound for Bangkok-local inclusive end day of a pos range. */
export function posRangeUntilExclusiveMs(range: PosDateRange): number {
  const { endMs } = clampPosDateRange(range);
  return startOfLocalDay(endMs) + 24 * 60 * 60 * 1000;
}

/**
 * Signup + cumulative member trend for the dashboard date range.
 * `members` must include everyone with createdAt < untilExclusive (deleted already filtered).
 */
export function summarizeMemberGrowth(
  members: ShopMember[],
  range: PosDateRange,
): PosDashMembersSummary {
  const { startMs, endMs } = clampPosDateRange(range);
  const dayMs = 24 * 60 * 60 * 1000;
  const untilExclusive = startOfLocalDay(endMs) + dayMs;

  const created = members
    .map((m) => Number(m.createdAt) || 0)
    .filter((t) => t > 0 && t < untilExclusive)
    .sort((a, b) => a - b);

  let cumulativeStart = 0;
  for (const t of created) {
    if (t < startMs) cumulativeStart += 1;
    else break;
  }

  const map = new Map<string, PosDashMemberDayPoint>();
  for (let ms = startMs; ms <= endMs; ms += dayMs) {
    const dateMs = startOfLocalDay(ms);
    const dateKey = bangkokDateKey(dateMs);
    map.set(dateKey, {
      dateMs,
      dateKey,
      label: shortDayLabel(dateMs),
      signups: 0,
      cumulative: cumulativeStart,
    });
  }

  let running = cumulativeStart;
  let signupsInRange = 0;
  for (const t of created) {
    if (t < startMs) continue;
    if (t >= untilExclusive) break;
    const dateKey = bangkokDateKey(startOfLocalDay(t));
    const row = map.get(dateKey);
    if (!row) continue;
    row.signups += 1;
    signupsInRange += 1;
  }

  const days = [...map.values()].sort((a, b) => a.dateMs - b.dateMs);
  for (const row of days) {
    running += row.signups;
    row.cumulative = running;
  }

  const cumulativeEnd = days.length ? days[days.length - 1].cumulative : cumulativeStart;
  return {
    cumulativeStart,
    cumulativeEnd,
    signupsInRange,
    netChange: cumulativeEnd - cumulativeStart,
    byDay: days,
  };
}

/** Bills tagged with a member in the loaded sales set (completed only). */
export function summarizeMemberSalesTouch(sales: PosSale[]): {
  memberBillCount: number;
  memberSalesTotal: number;
  redeemBillCount: number;
  redeemTotal: number;
} {
  let memberBillCount = 0;
  let memberSalesTotal = 0;
  let redeemBillCount = 0;
  let redeemTotal = 0;
  for (const sale of activeSales(sales)) {
    if (sale.memberId) {
      memberBillCount += 1;
      memberSalesTotal = round2(memberSalesTotal + sale.total);
    }
    const redeem = Math.max(0, sale.redeemBaht || 0);
    if (redeem > 0) {
      redeemBillCount += 1;
      redeemTotal = round2(redeemTotal + redeem);
    }
  }
  return { memberBillCount, memberSalesTotal, redeemBillCount, redeemTotal };
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

/** ค้นหาสินค้าตามชื่อ/หมวด · หลายคำคั่นช่องว่าง = ต้องเจอครบทุกคำ (ไม่สนตัวพิมพ์) */
export function filterPosDashProducts(
  rows: PosDashProductRow[],
  query: string,
): PosDashProductRow[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = `${r.name} ${r.categoryName}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type PosDashProductSum = { count: number; qty: number; total: number; pct: number };

/** ผลรวมรายการที่ส่งเข้ามา · pct = เทียบยอดสินค้าทั้งหมดของช่วง (lineTotal) */
export function sumPosDashProducts(
  rows: PosDashProductRow[],
  grandTotal: number,
): PosDashProductSum {
  let qty = 0;
  let total = 0;
  for (const r of rows) {
    qty += r.qty;
    total += r.total;
  }
  total = Math.round(total * 100) / 100;
  const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 10000) / 100 : 0;
  return { count: rows.length, qty: Math.round(qty * 1000) / 1000, total, pct };
}
