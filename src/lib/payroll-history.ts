/**
 * สรุปประวัติจ่ายเงินเดือน/โบนัสรายเดือน — มุมพนักงาน + เจ้าของเลือกคน
 */
import {
  PAYROLL_KIND_LABELS,
  type PayrollItem,
  type PayrollKind,
} from "./payroll";

export type PayrollMonthSummary = {
  periodMonth: string;
  salaryMidPaid: number;
  salaryMidPending: number;
  salaryEndPaid: number;
  salaryEndPending: number;
  specialPaid: number;
  specialPending: number;
  bonusPaid: number;
  bonusPending: number;
  paidTotal: number;
  pendingTotal: number;
  /** มีรายการรอโอนในเดือนนี้ */
  hasPending: boolean;
  /** จ่ายแล้วอย่างน้อยหนึ่งรายการ และไม่มีรอ */
  paidComplete: boolean;
  items: PayrollItem[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function isSalaryKind(kind: PayrollKind) {
  return (
    kind === "salary_mid" ||
    kind === "salary_month_end" ||
    kind === "salary_special"
  );
}

/** กรองรายการของพนักงานคนหนึ่ง (ข้าม void) */
export function filterEmployeePayrollItems(
  items: PayrollItem[],
  employeeId: string,
): PayrollItem[] {
  const id = (employeeId || "").trim();
  if (!id) return [];
  return items.filter((i) => i.employeeId === id && i.status !== "void");
}

export function buildPayrollMonthSummaries(
  items: PayrollItem[],
): PayrollMonthSummary[] {
  const byMonth = new Map<string, PayrollItem[]>();
  for (const item of items) {
    if (!item.periodMonth || item.status === "void") continue;
    const list = byMonth.get(item.periodMonth) || [];
    list.push(item);
    byMonth.set(item.periodMonth, list);
  }

  const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
  return months.map((periodMonth) => {
    const rows = (byMonth.get(periodMonth) || []).sort(
      (a, b) => a.dueDate - b.dueDate || a.kind.localeCompare(b.kind),
    );
    let salaryMidPaid = 0;
    let salaryMidPending = 0;
    let salaryEndPaid = 0;
    let salaryEndPending = 0;
    let specialPaid = 0;
    let specialPending = 0;
    let bonusPaid = 0;
    let bonusPending = 0;
    let paidTotal = 0;
    let pendingTotal = 0;

    for (const row of rows) {
      const amt = round2(row.amount);
      if (row.status === "paid") {
        paidTotal += amt;
        if (row.kind === "salary_mid") salaryMidPaid += amt;
        else if (row.kind === "salary_month_end") salaryEndPaid += amt;
        else if (row.kind === "salary_special") specialPaid += amt;
        else if (row.kind === "bonus") bonusPaid += amt;
      } else if (row.status === "pending") {
        pendingTotal += amt;
        if (row.kind === "salary_mid") salaryMidPending += amt;
        else if (row.kind === "salary_month_end") salaryEndPending += amt;
        else if (row.kind === "salary_special") specialPending += amt;
        else if (row.kind === "bonus") bonusPending += amt;
      }
    }

    paidTotal = round2(paidTotal);
    pendingTotal = round2(pendingTotal);
    const hasPending = pendingTotal > 0;
    return {
      periodMonth,
      salaryMidPaid: round2(salaryMidPaid),
      salaryMidPending: round2(salaryMidPending),
      salaryEndPaid: round2(salaryEndPaid),
      salaryEndPending: round2(salaryEndPending),
      specialPaid: round2(specialPaid),
      specialPending: round2(specialPending),
      bonusPaid: round2(bonusPaid),
      bonusPending: round2(bonusPending),
      paidTotal,
      pendingTotal,
      hasPending,
      paidComplete: paidTotal > 0 && !hasPending,
      items: rows,
    };
  });
}

export function shortPayrollKindLabel(kind: PayrollKind): string {
  if (kind === "salary_mid") return "กลางเดือน";
  if (kind === "salary_month_end") return "สิ้นเดือน";
  if (kind === "salary_special") return "จ่ายแยก";
  if (kind === "bonus") return "โบนัส";
  return PAYROLL_KIND_LABELS[kind] || kind;
}

export function isPayrollSalaryKind(kind: PayrollKind) {
  return isSalaryKind(kind);
}
