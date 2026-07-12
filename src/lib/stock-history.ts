import {
  STOCK_COUNT_ROUNDS,
  roundDateMs,
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

export type StockHistoryMonthStats = {
  rounds: number;
  expectedRounds: number;
  itemsTracked: number;
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

export function buildStockHistoryGrid(
  sessions: StockCountSession[],
  items: StockItem[],
  year: number,
  month: number,
): { columns: StockHistoryItemCol[]; rows: StockHistoryRoundRow[] } {
  const columns = buildStockItemColumns(items);
  const sessionMap = new Map<string, StockCountSession>();
  for (const s of sessions) {
    if (s.year !== year || s.month !== month) continue;
    const key = String(s.dayOfMonth);
    const existing = sessionMap.get(key);
    if (!existing || s.submittedAt > existing.submittedAt) {
      sessionMap.set(key, s);
    }
  }

  const rounds = applicableRounds(year, month).slice().reverse();

  const rows: StockHistoryRoundRow[] = rounds.map((dayOfMonth) => {
    const session = sessionMap.get(String(dayOfMonth)) || null;
    const cells: StockHistoryCell[] = columns.map((col) => ({
      itemId: col.itemId,
      qty: session?.lines.find((l) => l.itemId === col.itemId)?.qty ?? null,
    }));
    const filled = cells.filter((c) => c.qty != null).length;
    return {
      dayOfMonth,
      dateMs: roundDateMs(year, month, dayOfMonth),
      session,
      cells,
      filled,
      total: columns.length,
    };
  });

  return { columns, rows };
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
