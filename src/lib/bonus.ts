import type { Employee } from "./employees";
import type { BonusDeductionLine, BonusDeductionMonthCounts, BonusDeductionRule } from "./bonus-deductions";
import { buildBonusDeductionLines, computeShopDeductPct } from "./bonus-deductions";
import { computeOtBonus, type OtEntry } from "./ot";
import { computeProdBonus, type ProdEntry } from "./production";
import {
  resolveBakerySalesRateForNewEntry,
  type RateScheduleEntry,
} from "./rate-schedule";

export type WorkerMonthBonus = {
  workerId: string;
  workerName: string;
  /**
   * ส่วนแบ่ง pool ขายเบเกอรี่ —
   * หารเฉพาะคนที่ลงทะเบียนทำงานในเดือนนั้น (ผลิตหรือชง) ไม่ใช่แค่มีชื่อในรายชื่อ
   */
  salesShare: number;
  /** โบนัสผลิตเบเกอรี่ */
  prodBonus: number;
  /** โบนัสชง */
  otMain: number;
  total: number;
  deductPct: number;
  deductAmount: number;
  remaining: number;
  /** true เมื่อเคยลงทะเบียนงานผลิต/ชงในเดือนนี้ → ได้หารโบนัสขาย */
  workedThisMonth: boolean;
};

export type MonthBonusReport = {
  year: number;
  month: number;
  /** จำนวนคนที่หารโบนัสขาย (เคยทำงานในเดือน) */
  employeeCount: number;
  /** ผลผลิตรวม (ชิ้น) ที่นับเข้าโบนัสขาย */
  totalProdQty: number;
  /** กองโบนัสขาย = Σ(จำนวนผลิต × เรทขายตามวันจากตารางเรท) */
  totalSalesPool: number;
  shopDeductPct: number;
  deductionLines: BonusDeductionLine[];
  totalDeducted: number;
  totalRemaining: number;
  rows: WorkerMonthBonus[];
};

export function parseMonthInput(value: string) {
  const [y, m] = value.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export function monthInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function isInMonth(ms: number, year: number, month: number) {
  const d = new Date(ms);
  return d.getFullYear() === year && d.getMonth() === month;
}

export function namesMatch(a: string, b: string) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function findWorkerName(names: string[], roster: Employee[], hint?: string) {
  if (hint) {
    const fromHint = roster.find((e) => namesMatch(e.name, hint));
    if (fromHint) return fromHint.name;
    if (names.some((n) => namesMatch(n, hint))) return hint;
  }
  for (const n of names) {
    const hit = roster.find((e) => namesMatch(e.name, n));
    if (hit) return hit.name;
  }
  return names[0] || "";
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** กองโบนัสขายจากจำนวนผลิต × เรทขายตามวัน (ตารางเรท) — ไม่ใช้ salesRate ที่ติดแถวผลิต */
export function computeBakerySalesPool(
  prodEntries: Pick<ProdEntry, "date" | "qtyProduced">[],
  bakerySalesSchedule: RateScheduleEntry[] = [],
): { totalProdQty: number; totalSalesPool: number } {
  let totalProdQty = 0;
  let totalSalesPool = 0;
  for (const row of prodEntries) {
    const qty = Number(row.qtyProduced) || 0;
    if (qty <= 0) continue;
    totalProdQty += qty;
    const rate = resolveBakerySalesRateForNewEntry(row.date, bakerySalesSchedule);
    totalSalesPool += qty * rate;
  }
  return {
    totalProdQty: round2(totalProdQty),
    totalSalesPool: round2(totalSalesPool),
  };
}

export function computeMonthBonus(
  otEntries: OtEntry[],
  prodEntries: ProdEntry[],
  employees: Employee[],
  year: number,
  month: number,
  deductionRules: BonusDeductionRule[],
  monthCounts: BonusDeductionMonthCounts,
  bakerySalesSchedule: RateScheduleEntry[] = [],
): MonthBonusReport {
  const active = employees.filter((e) => e.active);

  const otMonth = otEntries.filter((e) => isInMonth(e.date, year, month));
  // Count all prod rows in month — `paid` is a lock flag after month-close, not a filter.
  const prodMonth = prodEntries.filter((e) => isInMonth(e.date, year, month));

  const { totalProdQty, totalSalesPool } = computeBakerySalesPool(
    prodMonth,
    bakerySalesSchedule,
  );

  const deductionLines = buildBonusDeductionLines(monthCounts, deductionRules);
  const shopDeductPct = computeShopDeductPct(monthCounts, deductionRules);

  const byName = new Map<
    string,
    { workerId: string; otMain: number; prodBonus: number; workedThisMonth: boolean }
  >();

  for (const emp of active) {
    byName.set(emp.name, {
      workerId: emp.id,
      otMain: 0,
      prodBonus: 0,
      workedThisMonth: false,
    });
  }

  function ensureWorker(name: string) {
    const canonical = findWorkerName([name], active) || name;
    if (!byName.has(canonical)) {
      byName.set(canonical, {
        workerId: active.find((e) => namesMatch(e.name, canonical))?.id || canonical,
        otMain: 0,
        prodBonus: 0,
        workedThisMonth: false,
      });
    }
    return canonical;
  }

  /** นับคนในแถว — ใช้ workerIds ก่อน แล้วค่อยชื่อ (กันเปลี่ยนชื่อแล้วโบนัสแตกเป็น 2 แถว) */
  function creditEntryWorkers(
    row: { workerIds?: string[]; workerNames?: string[] },
    credit: (slot: { otMain: number; prodBonus: number; workedThisMonth: boolean }) => void,
  ) {
    const credited = new Set<string>();
    for (const id of row.workerIds || []) {
      const emp = active.find((e) => e.id === id);
      if (!emp) continue;
      const name = ensureWorker(emp.name);
      credit(byName.get(name)!);
      credited.add(emp.id);
    }
    for (const rawName of row.workerNames || []) {
      const matched = active.find((e) => namesMatch(e.name, rawName));
      if (matched && credited.has(matched.id)) continue;
      const name = ensureWorker(rawName);
      const emp = active.find((e) => namesMatch(e.name, name));
      if (emp && credited.has(emp.id)) continue;
      credit(byName.get(name)!);
      if (emp) credited.add(emp.id);
    }
  }

  for (const row of otMonth) {
    const c = computeOtBonus(row);
    creditEntryWorkers(row, (slot) => {
      slot.otMain = round2(slot.otMain + c.bonusPerPerson);
      slot.workedThisMonth = true;
    });
  }

  for (const row of prodMonth) {
    const c = computeProdBonus(row);
    creditEntryWorkers(row, (slot) => {
      slot.prodBonus = round2(slot.prodBonus + c.bonusPerPerson);
      slot.workedThisMonth = true;
    });
  }

  const salesSharePeople = [...byName.values()].filter((s) => s.workedThisMonth).length;
  const employeeCount = salesSharePeople;
  const salesShareEach =
    salesSharePeople > 0 ? round2(totalSalesPool / salesSharePeople) : 0;

  const rows: WorkerMonthBonus[] = [...byName.entries()]
    .map(([workerName, slot]) => {
      const salesShare = slot.workedThisMonth ? salesShareEach : 0;
      const total = round2(salesShare + slot.prodBonus + slot.otMain);
      const deductAmount = round2(total * (shopDeductPct / 100));
      const remaining = round2(Math.max(0, total - deductAmount));
      return {
        workerId: slot.workerId,
        workerName,
        salesShare,
        prodBonus: slot.prodBonus,
        otMain: slot.otMain,
        total,
        deductPct: shopDeductPct,
        deductAmount,
        remaining,
        workedThisMonth: slot.workedThisMonth,
      };
    })
    .sort((a, b) => b.remaining - a.remaining || a.workerName.localeCompare(b.workerName, "th"));

  const totalDeducted = round2(rows.reduce((s, r) => s + r.deductAmount, 0));
  const totalRemaining = round2(rows.reduce((s, r) => s + r.remaining, 0));

  return {
    year,
    month,
    employeeCount,
    totalProdQty,
    totalSalesPool,
    shopDeductPct,
    deductionLines,
    totalDeducted,
    totalRemaining,
    rows,
  };
}

export function pickMyBonusRow(
  report: MonthBonusReport,
  roster: Employee[],
  displayName?: string,
): WorkerMonthBonus | null {
  if (!displayName?.trim()) return null;
  return report.rows.find((r) => namesMatch(r.workerName, displayName)) || null;
}

/**
 * คำนวณแถวโบนัสของพนักงานคนเดียว จาก OT/ผลิตของตัวเอง + พูลสรุป (bonusLivePool)
 * ใช้เมื่อ staff อ่าน entry ทั้งร้านไม่ได้
 */
export function computePersonalBonusRow(input: {
  otEntries: OtEntry[];
  prodEntries: ProdEntry[];
  employee: Employee;
  year: number;
  month: number;
  shopDeductPct: number;
  totalSalesPool: number;
  employeeCount: number;
}): WorkerMonthBonus {
  const { otEntries, prodEntries, employee, year, month } = input;
  const otMonth = otEntries.filter((e) => isInMonth(e.date, year, month));
  const prodMonth = prodEntries.filter((e) => isInMonth(e.date, year, month));

  let otMain = 0;
  let prodBonus = 0;
  let worked = false;

  for (const row of otMonth) {
    const c = computeOtBonus(row);
    const onRow =
      row.workerIds?.includes(employee.id) ||
      row.workerNames.some((n) => namesMatch(n, employee.name));
    if (!onRow) continue;
    otMain = round2(otMain + c.bonusPerPerson);
    worked = true;
  }
  for (const row of prodMonth) {
    const c = computeProdBonus(row);
    const onRow =
      row.workerIds?.includes(employee.id) ||
      row.workerNames.some((n) => namesMatch(n, employee.name));
    if (!onRow) continue;
    prodBonus = round2(prodBonus + c.bonusPerPerson);
    worked = true;
  }

  const salesShare =
    worked && input.employeeCount > 0
      ? round2(input.totalSalesPool / input.employeeCount)
      : 0;
  const total = round2(salesShare + prodBonus + otMain);
  const deductAmount = round2(total * (input.shopDeductPct / 100));
  const remaining = round2(Math.max(0, total - deductAmount));

  return {
    workerId: employee.id,
    workerName: employee.name,
    salesShare,
    prodBonus,
    otMain,
    total,
    deductPct: input.shopDeductPct,
    deductAmount,
    remaining,
    workedThisMonth: worked,
  };
}

export function thaiMonthYearLabel(year: number, month: number) {
  const months = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `${months[month]} ${year + 543}`;
}
