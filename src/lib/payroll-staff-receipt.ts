/**
 * สรุปรอบโอนล่าสุดของพนักงาน — การ์ดหลังจ่าย / ประวัติโอนรวม
 */
import type { PayrollItem } from "./payroll";

export type StaffTransferLine = {
  kind: PayrollItem["kind"];
  amount: number;
  advanceDeduct: number;
  grossAmount: number;
  /** โบนัสคงเหลือตอนสร้างคิว (หลังหักร้าน ถ้าเป็นโบนัส) */
  bonusRemaining: number;
  note: string;
  item: PayrollItem;
};

export type StaffTransferReceipt = {
  /** combinedPayId หรือ id รายการเดี่ยว */
  key: string;
  combined: boolean;
  periodMonth: string;
  paidAt: number;
  transferTotal: number;
  advanceDeductTotal: number;
  slipUrls: string[];
  note: string;
  lines: StaffTransferLine[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function uniqUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const t = (u || "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function lineFromItem(item: PayrollItem): StaffTransferLine {
  return {
    kind: item.kind,
    amount: round2(item.amount),
    advanceDeduct: round2(item.advanceDeduct),
    grossAmount: round2(item.grossAmount),
    bonusRemaining: round2(item.bonusRemaining),
    note: (item.note || "").trim(),
    item,
  };
}

/**
 * รวมรายการจ่ายแล้วเป็นรอบโอน — คู่โอนรวมใช้ combinedPayId เดียวกัน
 */
export function buildStaffTransferReceipts(
  items: PayrollItem[],
): StaffTransferReceipt[] {
  const paid = items.filter((i) => i.status === "paid");
  const byCombined = new Map<string, PayrollItem[]>();
  const singles: PayrollItem[] = [];

  for (const item of paid) {
    const cid = (item.combinedPayId || "").trim();
    if (cid) {
      const list = byCombined.get(cid) || [];
      list.push(item);
      byCombined.set(cid, list);
    } else {
      singles.push(item);
    }
  }

  const receipts: StaffTransferReceipt[] = [];

  for (const [cid, group] of byCombined) {
    const lines = [...group]
      .sort((a, b) => a.dueDate - b.dueDate || a.kind.localeCompare(b.kind))
      .map(lineFromItem);
    const paidAt = Math.max(...group.map((i) => i.paidAt || i.updatedAt || 0));
    const transferTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const advanceDeductTotal = round2(
      lines.reduce((s, l) => s + l.advanceDeduct, 0),
    );
    const notes = lines.map((l) => l.note).filter(Boolean);
    receipts.push({
      key: cid,
      combined: true,
      periodMonth: group[0]?.periodMonth || "",
      paidAt,
      transferTotal,
      advanceDeductTotal,
      slipUrls: uniqUrls(group.flatMap((i) => i.slipUrls || [])),
      note: notes[0] || "",
      lines,
    });
  }

  for (const item of singles) {
    const line = lineFromItem(item);
    receipts.push({
      key: item.id,
      combined: false,
      periodMonth: item.periodMonth,
      paidAt: item.paidAt || item.updatedAt || 0,
      transferTotal: line.amount,
      advanceDeductTotal: line.advanceDeduct,
      slipUrls: uniqUrls(item.slipUrls || []),
      note: line.note,
      lines: [line],
    });
  }

  return receipts.sort(
    (a, b) => b.paidAt - a.paidAt || b.periodMonth.localeCompare(a.periodMonth),
  );
}

/** รอบโอนล่าสุดของชุดรายการ (มักกรองเฉพาะ employee แล้ว) */
export function findLatestStaffTransferReceipt(
  items: PayrollItem[],
): StaffTransferReceipt | null {
  return buildStaffTransferReceipts(items)[0] || null;
}

/** ข้อความคัดลอกตอนโอนรวม — ชื่อ · ธนาคาร · เลขบัญชี · ยอด */
export function buildCombinedTransferClipboard(input: {
  employeeName: string;
  payBank?: string;
  payAccountNo?: string;
  payAccountName?: string;
  transferTotal: number;
  salaryAmount: number;
  bonusAmount: number;
  advanceDeduct?: number;
}): string {
  const bank = (input.payBank || "").trim();
  const acct = (input.payAccountNo || "").trim();
  const acctName = (input.payAccountName || "").trim();
  const lines = [
    input.employeeName.trim(),
    acctName && acctName !== input.employeeName.trim() ? `ชื่อบัญชี ${acctName}` : "",
    [bank, acct].filter(Boolean).join(" "),
    `ยอดโอน ฿${round2(input.transferTotal).toFixed(2)}`,
    `สิ้นเดือน ฿${round2(input.salaryAmount).toFixed(2)}` +
      (input.advanceDeduct && input.advanceDeduct > 0
        ? ` (หักเบิก ฿${round2(input.advanceDeduct).toFixed(2)})`
        : ""),
    `โบนัส ฿${round2(input.bonusAmount).toFixed(2)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function shortTransferKindLabel(kind: PayrollItem["kind"]): string {
  if (kind === "salary_mid") return "กลางเดือน";
  if (kind === "salary_month_end") return "สิ้นเดือน";
  if (kind === "salary_special") return "จ่ายแยก";
  if (kind === "bonus") return "โบนัส";
  return kind;
}
