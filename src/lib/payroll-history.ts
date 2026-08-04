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
  /** ยอดโอนสุทธิ */
  salaryMidPaid: number;
  salaryMidPending: number;
  salaryEndPaid: number;
  salaryEndPending: number;
  specialPaid: number;
  specialPending: number;
  bonusPaid: number;
  bonusPending: number;
  /** ยอดก่อนหักคืนเบิก (เงินเดือนที่ถึงกำหนด) */
  salaryGrossPaid: number;
  salaryGrossPending: number;
  bonusGrossPaid: number;
  bonusGrossPending: number;
  /** รวมคืนเบิกในเดือน */
  advanceDeductPaid: number;
  advanceDeductPending: number;
  /** รวมยอดโอนเข้าบัญชี */
  paidTotal: number;
  pendingTotal: number;
  /** มีรายการรอโอนในเดือนนี้ */
  hasPending: boolean;
  /** จ่ายแล้วอย่างน้อยหนึ่งรายการ และไม่มีรอ */
  paidComplete: boolean;
  items: PayrollItem[];
};

function itemGross(row: Pick<PayrollItem, "grossAmount" | "amount" | "advanceDeduct">) {
  const g = round2(Number(row.grossAmount) || 0);
  if (g > 0) return g;
  return round2((Number(row.amount) || 0) + (Number(row.advanceDeduct) || 0));
}

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
    let salaryGrossPaid = 0;
    let salaryGrossPending = 0;
    let bonusGrossPaid = 0;
    let bonusGrossPending = 0;
    let advanceDeductPaid = 0;
    let advanceDeductPending = 0;
    let paidTotal = 0;
    let pendingTotal = 0;

    for (const row of rows) {
      const amt = round2(row.amount);
      const gross = itemGross(row);
      const adv = round2(row.advanceDeduct || 0);
      if (row.status === "paid") {
        paidTotal += amt;
        advanceDeductPaid += adv;
        if (row.kind === "salary_mid") {
          salaryMidPaid += amt;
          salaryGrossPaid += gross;
        } else if (row.kind === "salary_month_end") {
          salaryEndPaid += amt;
          salaryGrossPaid += gross;
        } else if (row.kind === "salary_special") {
          specialPaid += amt;
          salaryGrossPaid += gross;
        } else if (row.kind === "bonus") {
          bonusPaid += amt;
          bonusGrossPaid += gross;
        }
      } else if (row.status === "pending") {
        pendingTotal += amt;
        advanceDeductPending += adv;
        if (row.kind === "salary_mid") {
          salaryMidPending += amt;
          salaryGrossPending += gross;
        } else if (row.kind === "salary_month_end") {
          salaryEndPending += amt;
          salaryGrossPending += gross;
        } else if (row.kind === "salary_special") {
          specialPending += amt;
          salaryGrossPending += gross;
        } else if (row.kind === "bonus") {
          bonusPending += amt;
          bonusGrossPending += gross;
        }
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
      salaryGrossPaid: round2(salaryGrossPaid),
      salaryGrossPending: round2(salaryGrossPending),
      bonusGrossPaid: round2(bonusGrossPaid),
      bonusGrossPending: round2(bonusGrossPending),
      advanceDeductPaid: round2(advanceDeductPaid),
      advanceDeductPending: round2(advanceDeductPending),
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

/** meta ใต้คอลัมน์เงินเดือนในตารางประวัติ — แยกกลาง/สิ้น/แยก + คืนเบิก */
export function salaryHistoryMetaBits(row: PayrollMonthSummary): string[] {
  const bits: string[] = [];
  const midGross = row.items
    .filter((i) => i.kind === "salary_mid" && i.status !== "void")
    .reduce((s, i) => s + itemGross(i), 0);
  const endGross = row.items
    .filter((i) => i.kind === "salary_month_end" && i.status !== "void")
    .reduce((s, i) => s + itemGross(i), 0);
  const specialGross = row.items
    .filter((i) => i.kind === "salary_special" && i.status !== "void")
    .reduce((s, i) => s + itemGross(i), 0);
  if (midGross > 0) bits.push(`กลาง ฿${formatAmt(round2(midGross))}`);
  if (endGross > 0) bits.push(`สิ้น ฿${formatAmt(round2(endGross))}`);
  if (specialGross > 0) bits.push(`แยก ฿${formatAmt(round2(specialGross))}`);
  const salaryAdv = round2(
    row.items
      .filter(
        (i) =>
          i.status !== "void" &&
          (i.kind === "salary_mid" ||
            i.kind === "salary_month_end" ||
            i.kind === "salary_special"),
      )
      .reduce((s, i) => s + (i.advanceDeduct || 0), 0),
  );
  if (salaryAdv > 0) bits.push(`คืนเบิก ฿${formatAmt(salaryAdv)}`);
  return bits;
}

function formatAmt(n: number) {
  const r = round2(n);
  return Number.isInteger(r)
    ? String(r)
    : r.toLocaleString("th-TH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
}

/** หาคู่โอนรวมในรายการเดือน — สำหรับโชว์ยอดโอนครั้งเดียว */
export function findCombinedTransferTotal(
  items: PayrollItem[],
  combinedPayId: string,
): number {
  const id = (combinedPayId || "").trim();
  if (!id) return 0;
  return round2(
    items
      .filter((i) => i.combinedPayId === id && i.status === "paid")
      .reduce((s, i) => s + i.amount, 0),
  );
}
