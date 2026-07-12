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
      cashPlus: net - asset,
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
