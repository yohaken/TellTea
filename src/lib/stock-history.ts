import {
  STOCK_COUNT_ROUNDS,
  roundDateMs,
  stockCountSessionId,
} from "./stock-count";
import type { StockCountRound, StockCountSession, StockItem } from "./types";

export type StockHistoryItemCol = {
  itemId: string;
  name: string;
  unit: string;
  shortName: string;
};

export type StockHistoryCell = {
  itemId: string;
  qty: number | null;
};

export type StockHistoryRoundRow = {
  dayOfMonth: StockCountRound;
  dateMs: number;
  session: StockCountSession | null;
  cells: StockHistoryCell[];
  filled: number;
  total: number;
};

export type StockHistoryTimelineRow = StockHistoryRoundRow & {
  rowKey: string;
  year: number;
  month: number;
  monthLabel: string;
};

export type StockHistoryMonthStats = {
  rounds: number;
  expectedRounds: number;
  itemsTracked: number;
};

export type StockHistoryTimelineStats = {
  filledRounds: number;
  totalRounds: number;
  itemsTracked: number;
  rangeLabel: string;
};

export function stockMonthInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function parseStockMonthInput(value: string) {
  const [y, m] = value.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export function itemShortName(name: string, max = 8) {
  const n = name.trim();
  if (n.length <= max) return n;
  return n.slice(0, max - 1) + "…";
}

export function buildStockItemColumns(items: StockItem[]): StockHistoryItemCol[] {
  return items.map((item) => ({
    itemId: item.id,
    name: item.name,
    unit: item.unit,
    shortName: itemShortName(item.name),
  }));
}

function monthYearKey(year: number, month: number) {
  return year * 12 + month;
}

function iterMonths(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const out: { year: number; month: number }[] = [];
  let y = fromYear;
  let m = fromMonth;
  while (monthYearKey(y, m) <= monthYearKey(toYear, toMonth)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

function applicableRounds(year: number, month: number): StockCountRound[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDay = today.getDate();

  return STOCK_COUNT_ROUNDS.filter((day) => {
    if (!isCurrentMonth) return true;
    return day <= todayDay;
  });
}

function latestSessionMap(sessions: StockCountSession[]): Map<string, StockCountSession> {
  const map = new Map<string, StockCountSession>();
  for (const s of sessions) {
    const key = stockCountSessionId(s.year, s.month, s.dayOfMonth);
    const existing = map.get(key);
    if (!existing || s.submittedAt > existing.submittedAt) {
      map.set(key, s);
    }
  }
  return map;
}

function buildRowCells(
  session: StockCountSession | null,
  columns: StockHistoryItemCol[],
): StockHistoryCell[] {
  return columns.map((col) => ({
    itemId: col.itemId,
    qty: session?.lines.find((l) => l.itemId === col.itemId)?.qty ?? null,
  }));
}

export function buildStockHistoryTimeline(
  sessions: StockCountSession[],
  items: StockItem[],
): { columns: StockHistoryItemCol[]; rows: StockHistoryTimelineRow[]; stats: StockHistoryTimelineStats } {
  const columns = buildStockItemColumns(items);
  const sessionMap = latestSessionMap(sessions);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  let minYear: number;
  let minMonth: number;
  let maxYear: number;
  let maxMonth: number;

  if (sessions.length) {
    const dates = sessions.map((s) => s.date);
    const minD = new Date(Math.min(...dates));
    const maxD = new Date(Math.max(...dates, todayMs));
    minYear = minD.getFullYear();
    minMonth = minD.getMonth();
    maxYear = maxD.getFullYear();
    maxMonth = maxD.getMonth();
  } else {
    minYear = maxYear = today.getFullYear();
    minMonth = maxMonth = today.getMonth();
  }

  const months = iterMonths(minYear, minMonth, maxYear, maxMonth);
  const rows: StockHistoryTimelineRow[] = [];

  for (let mi = months.length - 1; mi >= 0; mi -= 1) {
    const { year, month } = months[mi]!;
    const rounds = applicableRounds(year, month).slice().reverse();
    for (const dayOfMonth of rounds) {
      const rowKey = stockCountSessionId(year, month, dayOfMonth);
      const session = sessionMap.get(rowKey) || null;
      const cells = buildRowCells(session, columns);
      rows.push({
        rowKey,
        year,
        month,
        monthLabel: `${month + 1}/${String(year).slice(-2)}`,
        dayOfMonth,
        dateMs: roundDateMs(year, month, dayOfMonth),
        session,
        cells,
        filled: cells.filter((c) => c.qty != null).length,
        total: columns.length,
      });
    }
  }

  const filledRounds = rows.filter((r) => r.session).length;
  rows.sort((a, b) => b.dateMs - a.dateMs);
  const oldest = rows[rows.length - 1];
  const newest = rows[0];
  const rangeLabel =
    oldest && newest
      ? oldest.rowKey === newest.rowKey
        ? `${newest.monthLabel} · ${newest.dayOfMonth}`
        : `${oldest.monthLabel} → ${newest.monthLabel}`
      : "—";

  return {
    columns,
    rows,
    stats: {
      filledRounds,
      totalRounds: rows.length,
      itemsTracked: columns.length,
      rangeLabel,
    },
  };
}

/** @deprecated use buildStockHistoryTimeline — single month slice */
export function buildStockHistoryGrid(
  sessions: StockCountSession[],
  items: StockItem[],
  year: number,
  month: number,
): { columns: StockHistoryItemCol[]; rows: StockHistoryRoundRow[] } {
  const timeline = buildStockHistoryTimeline(sessions, items);
  const rows = timeline.rows.filter((r) => r.year === year && r.month === month);
  return { columns: timeline.columns, rows };
}

export function computeStockHistoryMonthStats(
  rows: StockHistoryRoundRow[],
  itemCount: number,
): StockHistoryMonthStats {
  const rounds = rows.filter((r) => r.session).length;
  return {
    rounds,
    expectedRounds: rows.length,
    itemsTracked: itemCount,
  };
}

export function formatStockCountTimeShort(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

export function inspectorShort(name: string) {
  const n = name.trim();
  if (n.length <= 8) return n;
  return n.slice(0, 7) + "…";
}

export function roundLabel(dayOfMonth: StockCountRound) {
  return `วันที่ ${dayOfMonth}`;
}

export function timelineRoundLabel(row: StockHistoryTimelineRow) {
  return `${row.monthLabel} · ${row.dayOfMonth}`;
}
