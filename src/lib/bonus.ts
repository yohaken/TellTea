import type { Employee } from "./employees";
import type { ChecklistRecord } from "./checklist";
import { computeOtBonus, type OtEntry } from "./ot";
import { computeProdBonus, type ProdEntry } from "./production";

/** อัตราหักโบนัสต่อครั้ง/หน่วย */
export const BONUS_DEDUCTION_RULES = [
  { id: "generalFail", label: "ผิดพลาดทั่วไป", pctPerUnit: 1 },
  { id: "waste", label: "ของเสีย", pctPerUnit: 3 },
] as const;

export type WorkerMonthBonus = {
  workerId: string;
  workerName: string;
  /** ส่วนแบ่ง pool ขายเบเกอรี่ (เท่ากันทุกคน) */
  salesShare: number;
  /** โบนัสผลิตเบเกอรี่ */
  prodBonus: number;
  /** โบนัสหลัก OT / ชง */
  otMain: number;
  total: number;
  /** จำนวนครั้งไม่ผ่าน SmartCheck */
  generalFailCount: number;
  /** จำนวนของเสีย (หน่วย) */
  wasteQty: number;
  deductPct: number;
  deductAmount: number;
  remaining: number;
};

export type BonusDeductionSummary = {
  generalFailCount: number;
  wasteQty: number;
};

export type MonthBonusReport = {
  year: number;
  month: number;
  employeeCount: number;
  totalSalesPool: number;
  totalDeducted: number;
  totalRemaining: number;
  deductionSummary: BonusDeductionSummary;
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

export function computeWorkerDeductPct(generalFailCount: number, wasteQty: number) {
  const raw =
    generalFailCount * BONUS_DEDUCTION_RULES[0].pctPerUnit +
    wasteQty * BONUS_DEDUCTION_RULES[1].pctPerUnit;
  return Math.min(100, round2(raw));
}

export function computeMonthBonus(
  otEntries: OtEntry[],
  prodEntries: ProdEntry[],
  employees: Employee[],
  year: number,
  month: number,
  checkRecords: ChecklistRecord[] = [],
): MonthBonusReport {
  const active = employees.filter((e) => e.active);

  const otMonth = otEntries.filter((e) => isInMonth(e.date, year, month));
  const prodMonth = prodEntries.filter((e) => isInMonth(e.date, year, month));
  const checkMonth = checkRecords.filter(
    (r) => r.status === "fail" && isInMonth(r.date, year, month),
  );

  const totalSalesPool = round2(
    prodMonth.reduce((sum, row) => sum + computeProdBonus(row).salesBonus, 0),
  );

  const employeeCount = Math.max(1, active.length);
  const salesShareEach = round2(totalSalesPool / employeeCount);

  const byName = new Map<
    string,
    { workerId: string; otMain: number; prodBonus: number; generalFailCount: number; wasteQty: number }
  >();

  for (const emp of active) {
    byName.set(emp.name, {
      workerId: emp.id,
      otMain: 0,
      prodBonus: 0,
      generalFailCount: 0,
      wasteQty: 0,
    });
  }

  function ensureWorker(name: string) {
    const canonical = findWorkerName([name], active) || name;
    if (!byName.has(canonical)) {
      byName.set(canonical, {
        workerId: active.find((e) => namesMatch(e.name, canonical))?.id || canonical,
        otMain: 0,
        prodBonus: 0,
        generalFailCount: 0,
        wasteQty: 0,
      });
    }
    return canonical;
  }

  for (const row of otMonth) {
    const c = computeOtBonus(row);
    for (const rawName of row.workerNames) {
      const name = ensureWorker(rawName);
      const slot = byName.get(name)!;
      slot.otMain = round2(slot.otMain + c.bonusPerPerson);
    }
  }

  for (const row of prodMonth) {
    const c = computeProdBonus(row);
    const wasteEach = row.workerNames.length
      ? round2((Number(row.qtyWaste) || 0) / row.workerNames.length)
      : 0;
    for (const rawName of row.workerNames) {
      const name = ensureWorker(rawName);
      const slot = byName.get(name)!;
      slot.prodBonus = round2(slot.prodBonus + c.bonusPerPerson);
      slot.wasteQty = round2(slot.wasteQty + wasteEach);
    }
  }

  for (const row of checkMonth) {
    const name = ensureWorker(row.inspector);
    const slot = byName.get(name)!;
    slot.generalFailCount += 1;
  }

  const rows: WorkerMonthBonus[] = [...byName.entries()]
    .map(([workerName, slot]) => {
      const total = round2(salesShareEach + slot.prodBonus + slot.otMain);
      const deductPct = computeWorkerDeductPct(slot.generalFailCount, slot.wasteQty);
      const deductAmount = round2(total * (deductPct / 100));
      const remaining = round2(Math.max(0, total - deductAmount));
      return {
        workerId: slot.workerId,
        workerName,
        salesShare: salesShareEach,
        prodBonus: slot.prodBonus,
        otMain: slot.otMain,
        total,
        generalFailCount: slot.generalFailCount,
        wasteQty: slot.wasteQty,
        deductPct,
        deductAmount,
        remaining,
      };
    })
    .sort((a, b) => b.remaining - a.remaining || a.workerName.localeCompare(b.workerName, "th"));

  const deductionSummary: BonusDeductionSummary = {
    generalFailCount: checkMonth.length,
    wasteQty: round2(
      prodMonth.reduce((sum, row) => sum + (Number(row.qtyWaste) || 0), 0),
    ),
  };

  const totalDeducted = round2(rows.reduce((s, r) => s + r.deductAmount, 0));
  const totalRemaining = round2(rows.reduce((s, r) => s + r.remaining, 0));

  return {
    year,
    month,
    employeeCount,
    totalSalesPool,
    totalDeducted,
    totalRemaining,
    deductionSummary,
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

export function thaiMonthYearLabel(year: number, month: number) {
  const months = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `${months[month]} ${year + 543}`;
}
