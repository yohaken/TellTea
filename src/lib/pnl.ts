import {
  collection,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { listLedgerEntries } from "./ledger";
import { listOwnerBookEntries } from "./owner-books";
import {
  daysInMonthKey,
  monthKeyFromMs,
  normalizeCategory,
  type CategoryBucket,
  type PnlCategory,
} from "./categories";

export type MonthCategoryRow = {
  month: string;
  asset: number;
  cogs: number;
  sga: number;
  other: number;
};

export type CombinedMonthRow = MonthCategoryRow;

export type PnlMonthRow = {
  month: string;
  income: number;
  incomePerDay: number;
  cogs: number;
  cogsPct: number | null;
  gross: number;
  grossPct: number | null;
  grossPerDay: number;
  sga: number;
  sgaPct: number | null;
  sgaPerDay: number;
  ebitda: number;
  net: number;
  netPct: number | null;
  netPerDay: number;
  asset: number;
  investOverNet: number | null;
  cashPlus: number;
  /** เงินสด+ ต่อกำไรสุทธิ (Cash+ / net) */
  cashOverNet: number | null;
};

function emptyCats(): Record<CategoryBucket, number> {
  return { asset: 0, cogs: 0, sga: 0, other: 0 };
}

function accumulateOut(
  map: Map<string, Record<CategoryBucket, number>>,
  dateMs: number,
  amountOut: number,
  type: string,
) {
  const out = Number(amountOut) || 0;
  if (out <= 0) return;
  const month = monthKeyFromMs(dateMs);
  const cat = normalizeCategory(type);
  const row = map.get(month) || emptyCats();
  row[cat] += out;
  map.set(month, row);
}

function mapToRows(map: Map<string, Record<CategoryBucket, number>>): MonthCategoryRow[] {
  return [...map.keys()]
    .sort()
    .map((month) => {
      const c = map.get(month)!;
      return {
        month,
        asset: c.asset,
        cogs: c.cogs,
        sga: c.sga,
        other: c.other,
      };
    });
}

export async function loadStaffMonthBreakdown(): Promise<MonthCategoryRow[]> {
  const entries = await listLedgerEntries();
  const map = new Map<string, Record<CategoryBucket, number>>();
  for (const e of entries) {
    accumulateOut(map, e.date, e.amountOut, e.type);
  }
  return mapToRows(map);
}

export async function loadOwnerMonthBreakdown(): Promise<MonthCategoryRow[]> {
  const entries = await listOwnerBookEntries();
  const map = new Map<string, Record<CategoryBucket, number>>();
  for (const e of entries) {
    accumulateOut(map, e.date, e.amountOut, e.type);
  }
  return mapToRows(map);
}

export function combineMonthBreakdowns(
  staff: MonthCategoryRow[],
  owner: MonthCategoryRow[],
): CombinedMonthRow[] {
  const map = new Map<string, Record<CategoryBucket, number>>();
  for (const src of [staff, owner]) {
    for (const row of src) {
      const cur = map.get(row.month) || emptyCats();
      cur.asset += row.asset;
      cur.cogs += row.cogs;
      cur.sga += row.sga;
      cur.other += row.other;
      map.set(row.month, cur);
    }
  }
  return mapToRows(map);
}

/** Manual monthly income — doc id = YYYY-MM */
export async function listMonthlyIncome(): Promise<Record<string, number>> {
  const snap = await getDocs(collection(getDb(), "monthlyIncome"));
  const out: Record<string, number> = {};
  for (const d of snap.docs) {
    out[d.id] = Number(d.data().income) || 0;
  }
  return out;
}

export async function saveMonthlyIncome(
  month: string,
  income: number,
  updatedBy: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("เดือนไม่ถูกต้อง");
  }
  const value = Number(income) || 0;
  if (value < 0) throw new Error("รายได้ต้องไม่ติดลบ");
  await setDoc(
    doc(getDb(), "monthlyIncome", month),
    { month, income: value, updatedAt: Date.now(), updatedBy },
    { merge: true },
  );
}

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return part / whole;
}

export function monthHasIncome(
  month: string,
  incomeByMonth: Record<string, number>,
): boolean {
  return (Number(incomeByMonth[month]) || 0) > 0;
}

/** เดือนที่ครบสำหรับโหมดสรุป — มีรายได้ > 0 */
export function completePnlMonths(
  pnl: PnlMonthRow[],
  incomeByMonth: Record<string, number>,
): string[] {
  return pnl.filter((r) => monthHasIncome(r.month, incomeByMonth)).map((r) => r.month);
}

export function filterCategoryRowsByMonths(
  rows: MonthCategoryRow[],
  months: string[],
): MonthCategoryRow[] {
  const set = new Set(months);
  return rows.filter((r) => set.has(r.month));
}

export function filterPnlRowsByMonths(rows: PnlMonthRow[], months: string[]): PnlMonthRow[] {
  const set = new Set(months);
  return rows.filter((r) => set.has(r.month));
}

export type CategoryTotals = {
  asset: number;
  cogs: number;
  sga: number;
  other: number;
};

export function sumCategoryRows(rows: MonthCategoryRow[]): CategoryTotals {
  return rows.reduce(
    (acc, r) => ({
      asset: acc.asset + r.asset,
      cogs: acc.cogs + r.cogs,
      sga: acc.sga + r.sga,
      other: acc.other + r.other,
    }),
    { asset: 0, cogs: 0, sga: 0, other: 0 },
  );
}

/** ค่าเฉลี่ยรายเดือน (Σ ÷ จำนวนเดือน) */
export function averageCategoryRows(rows: MonthCategoryRow[]): CategoryTotals | null {
  if (!rows.length) return null;
  const n = rows.length;
  const t = sumCategoryRows(rows);
  return {
    asset: t.asset / n,
    cogs: t.cogs / n,
    sga: t.sga / n,
    other: t.other / n,
  };
}

function meanNullable(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** รวมยอดเงิน + % ถ่วงรายได้ + ต่อวันจากยอดรวม/วันรวม */
export function summarizePnlRows(rows: PnlMonthRow[]): PnlMonthRow | null {
  if (!rows.length) return null;
  let income = 0;
  let cogs = 0;
  let sga = 0;
  let asset = 0;
  let days = 0;
  for (const r of rows) {
    income += r.income;
    cogs += r.cogs;
    sga += r.sga;
    asset += r.asset;
    days += daysInMonthKey(r.month) || 0;
  }
  days = days || 1;
  const gross = income - cogs;
  const ebitda = gross - sga;
  const net = ebitda;
  const cashPlus = net - asset;
  return {
    month: "รวม",
    income,
    incomePerDay: income / days,
    cogs,
    cogsPct: pct(cogs, income),
    gross,
    grossPct: pct(gross, income),
    grossPerDay: gross / days,
    sga,
    sgaPct: pct(sga, income),
    sgaPerDay: sga / days,
    ebitda,
    net,
    netPct: pct(net, income),
    netPerDay: net / days,
    asset,
    investOverNet: pct(asset, net),
    cashPlus,
    cashOverNet: pct(cashPlus, net),
  };
}

/**
 * ค่าเฉลี่ยรายเดือนตามมาตรฐาน:
 * - ยอดเงิน = Σ/n
 * - /วัน = เฉลี่ยของค่า /วัน รายเดือน
 * - % = เฉลี่ยเลขคณิตของอัตรารายเดือน (ใช้คู่กับแถวรวมที่ถ่วงรายได้)
 */
export function averagePnlRows(rows: PnlMonthRow[]): PnlMonthRow | null {
  if (!rows.length) return null;
  const n = rows.length;
  const income = rows.reduce((s, r) => s + r.income, 0) / n;
  const cogs = rows.reduce((s, r) => s + r.cogs, 0) / n;
  const sga = rows.reduce((s, r) => s + r.sga, 0) / n;
  const asset = rows.reduce((s, r) => s + r.asset, 0) / n;
  const gross = rows.reduce((s, r) => s + r.gross, 0) / n;
  const ebitda = rows.reduce((s, r) => s + r.ebitda, 0) / n;
  const net = rows.reduce((s, r) => s + r.net, 0) / n;
  const cashPlus = rows.reduce((s, r) => s + r.cashPlus, 0) / n;
  return {
    month: "เฉลี่ย",
    income,
    incomePerDay: rows.reduce((s, r) => s + r.incomePerDay, 0) / n,
    cogs,
    cogsPct: meanNullable(rows.map((r) => r.cogsPct)),
    gross,
    grossPct: meanNullable(rows.map((r) => r.grossPct)),
    grossPerDay: rows.reduce((s, r) => s + r.grossPerDay, 0) / n,
    sga,
    sgaPct: meanNullable(rows.map((r) => r.sgaPct)),
    sgaPerDay: rows.reduce((s, r) => s + r.sgaPerDay, 0) / n,
    ebitda,
    net,
    netPct: meanNullable(rows.map((r) => r.netPct)),
    netPerDay: rows.reduce((s, r) => s + r.netPerDay, 0) / n,
    asset,
    investOverNet: meanNullable(rows.map((r) => r.investOverNet)),
    cashPlus,
    cashOverNet: meanNullable(rows.map((r) => r.cashOverNet)),
  };
}

export function buildPnlRows(
  combined: CombinedMonthRow[],
  incomeByMonth: Record<string, number>,
): PnlMonthRow[] {
  return combined.map((row) => {
    const income = Number(incomeByMonth[row.month]) || 0;
    const days = daysInMonthKey(row.month) || 1;
    const { cogs, sga, asset } = row;
    const gross = income - cogs;
    const ebitda = gross - sga;
    const net = ebitda;
    const cashPlus = net - asset;
    return {
      month: row.month,
      income,
      incomePerDay: income / days,
      cogs,
      cogsPct: pct(cogs, income),
      gross,
      grossPct: pct(gross, income),
      grossPerDay: gross / days,
      sga,
      sgaPct: pct(sga, income),
      sgaPerDay: sga / days,
      ebitda,
      net,
      netPct: pct(net, income),
      netPerDay: net / days,
      asset,
      investOverNet: pct(asset, net),
      cashPlus,
      cashOverNet: pct(cashPlus, net),
    };
  });
}

export type PnlReportData = {
  staff: MonthCategoryRow[];
  owner: MonthCategoryRow[];
  combined: CombinedMonthRow[];
  incomeByMonth: Record<string, number>;
  pnl: PnlMonthRow[];
};

export async function loadPnlReport(): Promise<PnlReportData> {
  const [staff, owner, incomeByMonth] = await Promise.all([
    loadStaffMonthBreakdown(),
    loadOwnerMonthBreakdown(),
    listMonthlyIncome(),
  ]);
  const combined = combineMonthBreakdowns(staff, owner);
  const pnl = buildPnlRows(combined, incomeByMonth);
  return { staff, owner, combined, incomeByMonth, pnl };
}

export type { PnlCategory };
