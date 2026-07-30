import {
  collection,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { listLedgerEntriesSince } from "./ledger";
import { listOwnerBookEntriesSince } from "./owner-books";
import { monthsAgoStartMs } from "./query-window";
import {
  daysInMonthKey,
  monthKeyFromMs,
  normalizeCategory,
  type CategoryBucket,
  type PnlCategory,
} from "./categories";
import { businessCostOut } from "./entry-vat";
import { normalizeMoney } from "./vat-sales";

/** P&L บนเว็บโหลดแค่ช่วงนี้ — ไม่สแกนบัญชีทั้งประวัติ */
export const PNL_LOOKBACK_MONTHS = 18;

export type MonthCategoryRow = {
  month: string;
  /** ต้นทุน/คชจ./สินทรัพย์ — หลังหักภาษีซื้อ */
  asset: number;
  cogs: number;
  sga: number;
  other: number;
  /** ภาษีซื้อแยกตามประเภท — ไม่ปนในต้นทุน */
  vatAsset: number;
  vatCogs: number;
  vatSga: number;
  vatOther: number;
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
  /** เงินสด+ ต่อรายได้ (Cash+ / income) — กระแสเงินสดต่อรายได้จริง */
  cashOverIncome: number | null;
  /** รวมภาษีซื้อจากบิล (ไม่หักซ้ำในกำไร — ไปหักภาษีขาย) */
  purchaseVat: number;
  vatCogs: number;
  vatSga: number;
  vatAsset: number;
};

type MonthAcc = {
  asset: number;
  cogs: number;
  sga: number;
  other: number;
  vatAsset: number;
  vatCogs: number;
  vatSga: number;
  vatOther: number;
};

function emptyMonthAcc(): MonthAcc {
  return {
    asset: 0,
    cogs: 0,
    sga: 0,
    other: 0,
    vatAsset: 0,
    vatCogs: 0,
    vatSga: 0,
    vatOther: 0,
  };
}

export function emptyMonthCategoryRow(month: string): MonthCategoryRow {
  return { month, ...emptyMonthAcc() };
}

export function purchaseVatTotal(
  row: Pick<MonthCategoryRow, "vatAsset" | "vatCogs" | "vatSga" | "vatOther">,
): number {
  return (
    (Number(row.vatAsset) || 0) +
    (Number(row.vatCogs) || 0) +
    (Number(row.vatSga) || 0) +
    (Number(row.vatOther) || 0)
  );
}

function addVatToAcc(acc: MonthAcc, cat: CategoryBucket, vat: number) {
  if (!(vat > 0)) return;
  if (cat === "asset") acc.vatAsset += vat;
  else if (cat === "cogs") acc.vatCogs += vat;
  else if (cat === "sga") acc.vatSga += vat;
  else acc.vatOther += vat;
}

function accumulateEntry(
  map: Map<string, MonthAcc>,
  dateMs: number,
  entry: {
    amountOut: number;
    type: string;
    hasVat?: boolean;
    vatInput?: number;
  },
) {
  const cost = businessCostOut(entry.amountOut, entry.hasVat, entry.vatInput);
  const vat =
    entry.hasVat && normalizeMoney(entry.vatInput) > 0
      ? normalizeMoney(entry.vatInput)
      : 0;
  if (!(cost > 0) && !(vat > 0)) return;
  const month = monthKeyFromMs(dateMs);
  const cat = normalizeCategory(entry.type);
  const row = map.get(month) || emptyMonthAcc();
  if (cost > 0) row[cat] += cost;
  addVatToAcc(row, cat, vat);
  map.set(month, row);
}

function mapToRows(map: Map<string, MonthAcc>): MonthCategoryRow[] {
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
        vatAsset: c.vatAsset,
        vatCogs: c.vatCogs,
        vatSga: c.vatSga,
        vatOther: c.vatOther,
      };
    });
}

function addCategoryRows(into: MonthAcc, row: MonthCategoryRow) {
  into.asset += row.asset;
  into.cogs += row.cogs;
  into.sga += row.sga;
  into.other += row.other;
  into.vatAsset += row.vatAsset;
  into.vatCogs += row.vatCogs;
  into.vatSga += row.vatSga;
  into.vatOther += row.vatOther;
}

export async function loadStaffMonthBreakdown(
  sinceMs = monthsAgoStartMs(PNL_LOOKBACK_MONTHS),
): Promise<MonthCategoryRow[]> {
  const entries = await listLedgerEntriesSince(sinceMs);
  const map = new Map<string, MonthAcc>();
  for (const e of entries) {
    accumulateEntry(map, e.date, e);
  }
  return mapToRows(map);
}

export async function loadOwnerMonthBreakdown(
  sinceMs = monthsAgoStartMs(PNL_LOOKBACK_MONTHS),
): Promise<MonthCategoryRow[]> {
  const entries = await listOwnerBookEntriesSince(sinceMs);
  const map = new Map<string, MonthAcc>();
  for (const e of entries) {
    accumulateEntry(map, e.date, e);
  }
  return mapToRows(map);
}

export function combineMonthBreakdowns(
  staff: MonthCategoryRow[],
  owner: MonthCategoryRow[],
): CombinedMonthRow[] {
  const map = new Map<string, MonthAcc>();
  for (const src of [staff, owner]) {
    for (const row of src) {
      const cur = map.get(row.month) || emptyMonthAcc();
      addCategoryRows(cur, row);
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
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  // Pad missing months with zeros so every summary month is a row (average ÷ same n).
  return months.map((month) => byMonth.get(month) || emptyMonthCategoryRow(month));
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
  vatAsset: number;
  vatCogs: number;
  vatSga: number;
  vatOther: number;
};

export function sumCategoryRows(rows: MonthCategoryRow[]): CategoryTotals {
  return rows.reduce(
    (acc, r) => ({
      asset: acc.asset + r.asset,
      cogs: acc.cogs + r.cogs,
      sga: acc.sga + r.sga,
      other: acc.other + r.other,
      vatAsset: acc.vatAsset + r.vatAsset,
      vatCogs: acc.vatCogs + r.vatCogs,
      vatSga: acc.vatSga + r.vatSga,
      vatOther: acc.vatOther + r.vatOther,
    }),
    emptyMonthAcc(),
  );
}

/** ค่าเฉลี่ยรายเดือน (Σ ÷ จำนวนแถวที่นำมาคำนวณ) */
export function averageCategoryRows(rows: MonthCategoryRow[]): CategoryTotals | null {
  if (!rows.length) return null;
  const n = rows.length;
  const t = sumCategoryRows(rows);
  return {
    asset: t.asset / n,
    cogs: t.cogs / n,
    sga: t.sga / n,
    other: t.other / n,
    vatAsset: t.vatAsset / n,
    vatCogs: t.vatCogs / n,
    vatSga: t.vatSga / n,
    vatOther: t.vatOther / n,
  };
}

/** เฉลี่ยเลขคณิต — ตัวส่วน = จำนวนแถวทั้งหมดที่นำมาคำนวณ (null นับเป็น 0 ในผลรวม) */
function meanOverRowCount(values: Array<number | null>, rowCount: number): number | null {
  if (!rowCount) return null;
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  if (!any) return null;
  return sum / rowCount;
}

/** รวมยอดเงิน + % ถ่วงรายได้ + ต่อวันจากยอดรวม/วันรวม */
export function summarizePnlRows(rows: PnlMonthRow[]): PnlMonthRow | null {
  if (!rows.length) return null;
  let income = 0;
  let cogs = 0;
  let sga = 0;
  let asset = 0;
  let purchaseVat = 0;
  let vatCogs = 0;
  let vatSga = 0;
  let vatAsset = 0;
  let days = 0;
  for (const r of rows) {
    income += r.income;
    cogs += r.cogs;
    sga += r.sga;
    asset += r.asset;
    purchaseVat += r.purchaseVat;
    vatCogs += r.vatCogs;
    vatSga += r.vatSga;
    vatAsset += r.vatAsset;
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
    cashOverIncome: pct(cashPlus, income),
    purchaseVat,
    vatCogs,
    vatSga,
    vatAsset,
  };
}

/**
 * ค่าเฉลี่ยรายเดือน — ตัวส่วนเสมอ = จำนวนแถวที่นำมาคำนวณ:
 * - ยอดเงิน = Σ/n
 * - /วัน = เฉลี่ยของค่า /วัน รายเดือน (÷n)
 * - % = เฉลี่ยเลขคณิตของอัตรารายเดือน (÷n; ค่าว่างนับเป็น 0)
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
  const purchaseVat = rows.reduce((s, r) => s + r.purchaseVat, 0) / n;
  const vatCogs = rows.reduce((s, r) => s + r.vatCogs, 0) / n;
  const vatSga = rows.reduce((s, r) => s + r.vatSga, 0) / n;
  const vatAsset = rows.reduce((s, r) => s + r.vatAsset, 0) / n;
  return {
    month: "เฉลี่ย",
    income,
    incomePerDay: rows.reduce((s, r) => s + r.incomePerDay, 0) / n,
    cogs,
    cogsPct: meanOverRowCount(
      rows.map((r) => r.cogsPct),
      n,
    ),
    gross,
    grossPct: meanOverRowCount(
      rows.map((r) => r.grossPct),
      n,
    ),
    grossPerDay: rows.reduce((s, r) => s + r.grossPerDay, 0) / n,
    sga,
    sgaPct: meanOverRowCount(
      rows.map((r) => r.sgaPct),
      n,
    ),
    sgaPerDay: rows.reduce((s, r) => s + r.sgaPerDay, 0) / n,
    ebitda,
    net,
    netPct: meanOverRowCount(
      rows.map((r) => r.netPct),
      n,
    ),
    netPerDay: rows.reduce((s, r) => s + r.netPerDay, 0) / n,
    asset,
    investOverNet: meanOverRowCount(
      rows.map((r) => r.investOverNet),
      n,
    ),
    cashPlus,
    cashOverIncome: meanOverRowCount(
      rows.map((r) => r.cashOverIncome),
      n,
    ),
    purchaseVat,
    vatCogs,
    vatSga,
    vatAsset,
  };
}

export function buildPnlRows(
  combined: CombinedMonthRow[],
  incomeByMonth: Record<string, number>,
): PnlMonthRow[] {
  return combined.map((row) => {
    const income = Number(incomeByMonth[row.month]) || 0;
    const days = daysInMonthKey(row.month) || 1;
    const { cogs, sga, asset, vatCogs, vatSga, vatAsset } = row;
    const purchaseVat = purchaseVatTotal(row);
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
      cashOverIncome: pct(cashPlus, income),
      purchaseVat,
      vatCogs,
      vatSga,
      vatAsset,
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

export async function loadPnlReport(
  lookbackMonths: number = PNL_LOOKBACK_MONTHS,
): Promise<PnlReportData> {
  const sinceMs = monthsAgoStartMs(lookbackMonths);
  const [staff, owner, incomeByMonth] = await Promise.all([
    loadStaffMonthBreakdown(sinceMs),
    loadOwnerMonthBreakdown(sinceMs),
    listMonthlyIncome(),
  ]);
  const combined = combineMonthBreakdowns(staff, owner);
  const pnl = buildPnlRows(combined, incomeByMonth);
  return { staff, owner, combined, incomeByMonth, pnl };
}

export type { PnlCategory };
