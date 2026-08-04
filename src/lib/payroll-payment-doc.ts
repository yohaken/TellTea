/**
 * หลักฐานการจ่ายค่าจ้างและเงินเดือน — เอกสารทางการขนาด A4
 * ดูในแอป · พิมพ์ / บันทึก PDF · ดาวน์โหลด HTML เก็บไว้
 */
import { escapeReceiptHtml } from "./pos-printer/receipt-template";
import type { PosShopSettings } from "./pos-settings";
import {
  buildStaffTransferReceipts,
  shortTransferKindLabel,
  type StaffTransferReceipt,
} from "./payroll-staff-receipt";
import type { PayrollItem } from "./payroll";
import { thaiBahtText } from "./thai-baht-text";
import {
  bangkokDatePartsBe,
  formatPlainNumber,
} from "./utils";

export type PayrollPaymentDocShop = {
  shopName: string;
  shopNameTh: string;
  shopAddress: string;
  shopPhone: string;
  taxId: string;
};

export type PayrollPaymentDocPayee = {
  /** ชื่อสำรองในระบบ (เอกสารไม่ใช้ — ใช้ชื่อจริงเท่านั้น) */
  employeeName: string;
  /** ชื่อจริงตามบัตร */
  legalFirstName?: string;
  /** นามสกุลตามบัตร */
  legalLastName?: string;
  payBank?: string;
  payAccountNo?: string;
  payAccountName?: string;
};

export type PayrollPaymentDocPayer = {
  payerName: string;
  payerTitle: string;
};

export function legalFullName(payee: PayrollPaymentDocPayee): string {
  const full = [payee.legalFirstName, payee.legalLastName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  return full || (payee.employeeName || "").trim() || "—";
}

/** เอกสารจ่ายใช้เฉพาะชื่อจริง–นามสกุลตามบัตร */
export function legalNameForPaymentDoc(payee: PayrollPaymentDocPayee): string {
  const full = [payee.legalFirstName, payee.legalLastName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  return full || "—";
}

export function payeeFromEmployee(
  emp:
    | {
        name?: string;
        payBank?: string;
        payAccountNo?: string;
        payAccountName?: string;
      }
    | null
    | undefined,
  fallbackName?: string,
  legal?: { legalFirstName?: string; legalLastName?: string } | null,
): PayrollPaymentDocPayee {
  return {
    employeeName:
      (emp?.name || "").trim() || (fallbackName || "").trim() || "—",
    legalFirstName: (legal?.legalFirstName || "").trim() || undefined,
    legalLastName: (legal?.legalLastName || "").trim() || undefined,
    payBank: (emp?.payBank || "").trim() || undefined,
    payAccountNo: (emp?.payAccountNo || "").trim() || undefined,
    payAccountName: (emp?.payAccountName || "").trim() || undefined,
  };
}

/** สรุปจ่ายทั้งเดือนต่อคน — กลางเดือน + สิ้นเดือน + โบนัส + รวม */
export type PayrollMonthPaymentSummary = {
  employeeId: string;
  employeeName: string;
  periodMonth: string;
  /** เงินเดือนเต็มต่อเดือน (จาก snapshot) — อ้างอิง ไม่ใช่ยอดโอน */
  salaryFull: number;
  /** ยอดโอนสุทธิหลังคืนเบิก */
  midAmount: number;
  midAdvance: number;
  /** ยอดก่อนหักคืนเบิก */
  midGross: number;
  endAmount: number;
  endAdvance: number;
  endGross: number;
  specialAmount: number;
  specialAdvance: number;
  specialGross: number;
  bonusAmount: number;
  bonusAdvance: number;
  bonusGross: number;
  /** รวมก่อนหักคืนเบิก */
  grossTotal: number;
  /** รวมยอดโอนเข้าบัญชี (= grossTotal - advanceDeductTotal) */
  transferTotal: number;
  /** รวมคืนเบิกล่วงหน้า (ได้เงินไปก่อนแล้ว — ไม่ใช่ลดเงินเดือน) */
  advanceDeductTotal: number;
  paidAt: number;
  slipUrls: string[];
  items: PayrollItem[];
};

function itemGross(row: Pick<PayrollItem, "grossAmount" | "amount" | "advanceDeduct">) {
  const g = round2(Number(row.grossAmount) || 0);
  if (g > 0) return g;
  return round2((Number(row.amount) || 0) + (Number(row.advanceDeduct) || 0));
}

function uniqUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const t = (u || "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function buildMonthPaymentSummary(
  items: PayrollItem[],
  employeeId: string,
  periodMonth: string,
  opts?: { monthlySalaryHint?: number },
): PayrollMonthPaymentSummary | null {
  const empId = (employeeId || "").trim();
  const month = (periodMonth || "").trim();
  if (!empId || !month) return null;
  const paid = items.filter(
    (i) =>
      i.employeeId === empId &&
      i.periodMonth === month &&
      i.status === "paid",
  );
  if (!paid.length) return null;

  let salaryFull = 0;
  let midAmount = 0;
  let midAdvance = 0;
  let midGross = 0;
  let endAmount = 0;
  let endAdvance = 0;
  let endGross = 0;
  let specialAmount = 0;
  let specialAdvance = 0;
  let specialGross = 0;
  let bonusAmount = 0;
  let bonusAdvance = 0;
  let bonusGross = 0;
  for (const row of paid) {
    if (row.kind === "salary_mid" || row.kind === "salary_month_end") {
      salaryFull = Math.max(salaryFull, round2(row.salaryBase || 0));
    }
    if (row.kind === "salary_mid") {
      midAmount = round2(midAmount + row.amount);
      midAdvance = round2(midAdvance + row.advanceDeduct);
      midGross = round2(midGross + itemGross(row));
    } else if (row.kind === "salary_month_end") {
      endAmount = round2(endAmount + row.amount);
      endAdvance = round2(endAdvance + row.advanceDeduct);
      endGross = round2(endGross + itemGross(row));
    } else if (row.kind === "salary_special") {
      specialAmount = round2(specialAmount + row.amount);
      specialAdvance = round2(specialAdvance + row.advanceDeduct);
      specialGross = round2(specialGross + itemGross(row));
    } else if (row.kind === "bonus") {
      bonusAmount = round2(bonusAmount + row.amount);
      bonusAdvance = round2(bonusAdvance + row.advanceDeduct);
      bonusGross = round2(bonusGross + itemGross(row));
    }
  }
  if (!(salaryFull > 0)) {
    const hint = round2(Number(opts?.monthlySalaryHint) || 0);
    if (hint > 0) salaryFull = hint;
  }
  const transferTotal = round2(
    midAmount + endAmount + specialAmount + bonusAmount,
  );
  const advanceDeductTotal = round2(
    midAdvance + endAdvance + specialAdvance + bonusAdvance,
  );
  const grossTotal = round2(midGross + endGross + specialGross + bonusGross);
  return {
    employeeId: empId,
    employeeName: paid[0]?.employeeName || "—",
    periodMonth: month,
    salaryFull,
    midAmount,
    midAdvance,
    midGross,
    endAmount,
    endAdvance,
    endGross,
    specialAmount,
    specialAdvance,
    specialGross,
    bonusAmount,
    bonusAdvance,
    bonusGross,
    grossTotal,
    transferTotal,
    advanceDeductTotal,
    paidAt: Math.max(...paid.map((i) => i.paidAt || i.updatedAt || 0)),
    slipUrls: uniqUrls(paid.flatMap((i) => i.slipUrls || [])),
    items: [...paid].sort(
      (a, b) => a.dueDate - b.dueDate || a.kind.localeCompare(b.kind),
    ),
  };
}

export function listMonthPaymentSummaries(
  items: PayrollItem[],
  periodMonth: string,
  opts?: {
    monthlySalaryByEmployeeId?: Record<string, number> | Map<string, number>;
  },
): PayrollMonthPaymentSummary[] {
  const month = (periodMonth || "").trim();
  if (!month) return [];
  const ids = new Set(
    items
      .filter((i) => i.periodMonth === month && i.status === "paid")
      .map((i) => i.employeeId),
  );
  const salaryMap = opts?.monthlySalaryByEmployeeId;
  const salaryHint = (id: string) => {
    if (!salaryMap) return undefined;
    if (salaryMap instanceof Map) return salaryMap.get(id);
    return salaryMap[id];
  };
  const out: PayrollMonthPaymentSummary[] = [];
  for (const id of ids) {
    const row = buildMonthPaymentSummary(items, id, month, {
      monthlySalaryHint: salaryHint(id),
    });
    if (row) out.push(row);
  }
  return out.sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName, "th"),
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function money(n: number) {
  return formatPlainNumber(round2(n));
}

const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/** งวด 2026-07 → ก.ค. 2569 */
export function formatPayrollPeriodLabel(periodMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((periodMonth || "").trim());
  if (!m) return periodMonth || "—";
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  if (!Number.isFinite(year) || monthIdx < 0 || monthIdx > 11) {
    return periodMonth;
  }
  return `${THAI_MONTHS_SHORT[monthIdx]} ${year + 543}`;
}

/** งวดเต็ม: กรกฎาคม พ.ศ. 2569 */
export function formatPayrollPeriodLabelFull(periodMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((periodMonth || "").trim());
  if (!m) return periodMonth || "—";
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  if (!Number.isFinite(year) || monthIdx < 0 || monthIdx > 11) {
    return periodMonth;
  }
  return `${THAI_MONTHS_FULL[monthIdx]} พ.ศ. ${year + 543}`;
}

/** วัน–เวลาโอนแบบเอกสาร: 31/7/2569 10:00 */
export function formatPayrollPaidAtLabel(ms: number): string {
  if (!ms) return "—";
  const p = bangkokDatePartsBe(ms);
  if (!p) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((x) => x.type === type)?.value || "";
  const hh = String(get("hour")).padStart(2, "0");
  const mi = String(get("minute")).padStart(2, "0");
  return `${p.day}/${p.month}/${p.yearBe} ${hh}:${mi} น.`;
}

/** วันที่แบบหนังสือ: วันที่ 31 กรกฎาคม พ.ศ. 2569 */
export function formatPayrollFormalDate(ms: number): string {
  if (!ms) return "—";
  const p = bangkokDatePartsBe(ms);
  if (!p) return "—";
  const monthName = THAI_MONTHS_FULL[p.month - 1] || "";
  return `วันที่ ${p.day} ${monthName} พ.ศ. ${p.yearBe}`;
}

export function payrollPaymentDocNo(input: {
  periodMonth: string;
  employeeId: string;
  paidAt: number;
}): string {
  const month = (input.periodMonth || "").replace(/-/g, "");
  const emp = (input.employeeId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-4)
    .toUpperCase() || "XX";
  const p = input.paidAt ? bangkokDatePartsBe(input.paidAt) : null;
  const d = p
    ? `${p.yearBe}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`
    : "00000000";
  return `PAY-${month || "000000"}-${emp}-${d}`;
}

export function shopFromPosSettings(
  shop: Pick<
    PosShopSettings,
    "shopName" | "shopNameTh" | "shopAddress" | "shopPhone" | "taxId"
  >,
): PayrollPaymentDocShop {
  return {
    shopName: (shop.shopName || "").trim() || "TELL TEA",
    shopNameTh: (shop.shopNameTh || "").trim() || "เทล ที",
    shopAddress: (shop.shopAddress || "").trim(),
    shopPhone: (shop.shopPhone || "").trim(),
    taxId: (shop.taxId || "").trim(),
  };
}

/** หาใบสรุปรอบโอนจาก key (combinedPayId หรือ id รายการ) */
export function findStaffTransferReceiptByKey(
  items: PayrollItem[],
  key: string,
): StaffTransferReceipt | null {
  const k = (key || "").trim();
  if (!k) return null;
  return buildStaffTransferReceipts(items).find((r) => r.key === k) || null;
}

/** สร้างใบสรุปจากรายการที่เพิ่ง mark จ่าย (ก่อน subscribe ตามทัน) */
export function buildReceiptFromJustPaid(input: {
  items: PayrollItem[];
  slipUrls?: string[];
  note?: string;
  paidAt?: number;
  combinedPayId?: string;
}): StaffTransferReceipt {
  const paidAt = input.paidAt || Date.now();
  const slipUrls = [...(input.slipUrls || [])].filter(Boolean);
  const note = (input.note || "").trim();
  const cid = (input.combinedPayId || "").trim();
  const lines = [...input.items]
    .sort((a, b) => a.dueDate - b.dueDate || a.kind.localeCompare(b.kind))
    .map((item) => ({
      kind: item.kind,
      amount: round2(item.amount),
      advanceDeduct: round2(item.advanceDeduct),
      grossAmount: round2(item.grossAmount),
      bonusRemaining: round2(item.bonusRemaining),
      note: (item.note || "").trim(),
      item: {
        ...item,
        status: "paid" as const,
        paidAt,
        slipUrls: slipUrls.length ? slipUrls : item.slipUrls,
        note: note || item.note,
        combinedPayId: cid || item.combinedPayId,
      },
    }));
  const transferTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const advanceDeductTotal = round2(
    lines.reduce((s, l) => s + l.advanceDeduct, 0),
  );
  return {
    key: cid || lines[0]?.item.id || `pay_${paidAt}`,
    combined: Boolean(cid) && lines.length > 1,
    periodMonth: lines[0]?.item.periodMonth || "",
    paidAt,
    transferTotal,
    advanceDeductTotal,
    slipUrls: slipUrls.length
      ? slipUrls
      : [...new Set(lines.flatMap((l) => l.item.slipUrls || []))],
    note: note || lines.map((l) => l.note).find(Boolean) || "",
    lines,
  };
}

export function payrollPaymentDocFilename(receipt: StaffTransferReceipt): string {
  const name =
    receipt.lines[0]?.item.employeeName?.replace(/\s+/g, "_") || "staff";
  const month = receipt.periodMonth || "month";
  const stamp = receipt.paidAt
    ? new Date(receipt.paidAt).toISOString().slice(0, 10)
    : "paid";
  return `หลักฐานจ่าย_${month}_${name}_${stamp}.html`;
}

function lineMetaBits(
  line: StaffTransferReceipt["lines"][number],
  receiptNote: string,
): string[] {
  const meta: string[] = [];
  if (line.grossAmount > 0 && round2(line.grossAmount) !== round2(line.amount)) {
    meta.push(`ก่อนหัก ฿${money(line.grossAmount)}`);
  }
  if (line.advanceDeduct > 0) {
    meta.push(`คืนเบิก ฿${money(line.advanceDeduct)} (ได้ไปก่อนแล้ว)`);
  }
  // โบนัส: โชว์ยอดก่อนหักร้านเฉพาะเมื่อต่างจากยอดโอน (ไม่ซ้ำกับคอลัมน์ยอด)
  if (
    line.kind === "bonus" &&
    line.bonusRemaining > 0 &&
    round2(line.bonusRemaining) !== round2(line.amount) &&
    round2(line.bonusRemaining) !== round2(line.grossAmount)
  ) {
    meta.push(`หลังหักร้าน ฿${money(line.bonusRemaining)}`);
  }
  const lineNote = (line.note || "").trim();
  if (lineNote && lineNote !== receiptNote) {
    meta.push(lineNote);
  }
  return meta;
}

function paymentDocCss(multiPage: boolean): string {
  return `
    @page { size: A4; margin: 14mm 12mm 14mm 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Sarabun", "TH Sarabun New", "Cordia New", "Tahoma", sans-serif;
      color: #111;
      background: #fff;
      font-size: 13.5px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    .sheet {
      width: 100%;
      max-width: 186mm;
      margin: 0 auto;
      padding: 2px 0 8px;
    }
    ${
      multiPage
        ? `.sheet + .sheet { page-break-before: always; break-before: page; }
    .bundle-cover {
      max-width: 186mm;
      margin: 0 auto 1rem;
      padding: 0.25rem 0 0.75rem;
      border-bottom: 1px solid #222;
      text-align: center;
    }
    .bundle-cover .org { font-size: 1.2rem; font-weight: 700; margin: 0; }
    .bundle-cover .title { font-size: 1rem; font-weight: 700; margin: 0.35rem 0 0; }
    .bundle-cover .meta { margin: 0.2rem 0 0; font-size: 0.9rem; color: #333; }`
        : ""
    }
    .head {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 8mm;
      align-items: start;
      padding-bottom: 2.5mm;
      border-bottom: 2px solid #111;
      margin-bottom: 3mm;
    }
    .org-name { font-size: 18px; font-weight: 700; margin: 0; line-height: 1.2; }
    .org-name-th { font-size: 14px; font-weight: 600; margin: 1px 0 3px; }
    .org-meta { font-size: 11px; line-height: 1.4; color: #222; margin: 0; }
    .doc-meta { font-size: 12px; line-height: 1.55; text-align: right; }
    .doc-meta strong { font-weight: 700; }
    .emp {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5mm 6mm;
      margin: 0 0 3mm;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .emp .k { color: #444; }
    .emp .v { font-weight: 600; }
    .main {
      display: grid;
      grid-template-columns: 1fr 1fr 46mm;
      gap: 2.5mm;
      align-items: stretch;
      margin-bottom: 3mm;
    }
    .col-wrap {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    table.col {
      width: 100%;
      height: 100%;
      border-collapse: collapse;
      font-size: 12px;
      table-layout: fixed;
    }
    table.col th, table.col td {
      border: 1px solid #222;
      padding: 3px 5px;
      vertical-align: top;
    }
    table.col thead th {
      background: #e8e8e8;
      text-align: center;
      font-weight: 700;
      font-size: 12.5px;
    }
    table.col td.num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      width: 26mm;
    }
    table.col td.desc { word-break: break-word; }
    table.col tr.foot td { background: #f0f0f0; font-weight: 700; }
    table.col td.pad { height: 1.15em; }
    .side {
      display: flex;
      flex-direction: column;
      gap: 2.5mm;
    }
    .box {
      border: 1.5px solid #222;
      padding: 3mm 2.5mm;
      text-align: center;
    }
    .box .lbl { font-size: 11px; color: #333; margin: 0 0 1mm; }
    .box .val { font-size: 13px; font-weight: 700; margin: 0; }
    .box.net {
      background: #f5f5f5;
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 28mm;
    }
    .box.net .val { font-size: 17px; }
    .box.net .sub { font-size: 10px; color: #444; margin-top: 1.5mm; font-weight: 400; line-height: 1.35; }
    .clarify {
      border: 1px solid #222;
      padding: 2.5mm 3mm;
      margin: 0 0 2.5mm;
      font-size: 12px;
      line-height: 1.45;
    }
    .clarify table { width: 100%; border-collapse: collapse; }
    .clarify td { padding: 1.5px 0; vertical-align: baseline; }
    .clarify td.num {
      text-align: right;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      width: 28mm;
    }
    .clarify tr.total td {
      border-top: 1.5px solid #111;
      padding-top: 3px;
      font-weight: 700;
      font-size: 12.5px;
    }
    .note {
      margin: 2mm 0 0;
      font-size: 10.5px;
      color: #333;
      line-height: 1.4;
    }
    .words {
      border: 1px solid #222;
      padding: 2.5mm 3mm;
      margin: 0 0 3mm;
      font-size: 12px;
      line-height: 1.45;
    }
    .words .k { font-weight: 700; margin-right: 0.35rem; }
    .signs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10mm;
      margin: 2mm 0 3mm;
    }
    .sign {
      text-align: center;
      font-size: 12px;
      border: 1px solid #222;
      padding: 2.5mm 3mm 3mm;
      min-height: 32mm;
    }
    .sign .cap { font-weight: 700; margin-bottom: 1mm; }
    .sign .blank {
      margin: 12mm 6mm 2mm;
      border-bottom: 1px solid #222;
      height: 0;
    }
    .sign .name { margin-top: 1mm; font-weight: 600; }
    .sign .role { color: #333; font-size: 11px; margin-top: 1px; }
    .sign .date-line { margin-top: 3mm; color: #333; font-size: 11px; }
    .foot {
      margin-top: 1mm;
      padding-top: 2.5mm;
      border-top: 1px solid #999;
      font-size: 10px;
      color: #444;
      line-height: 1.4;
    }
    .foot div + div { margin-top: 1mm; }
    @media print {
      body { margin: 0; background: #fff; }
      .sheet { padding: 0; max-width: none; }
      .bundle-cover { display: none; }
      a { color: inherit; text-decoration: none; }
    }
    @media (max-width: 560px) {
      .main { grid-template-columns: 1fr; }
      .signs { grid-template-columns: 1fr; gap: 4mm; }
      .emp { grid-template-columns: 1fr; }
      .head { grid-template-columns: 1fr; }
      .doc-meta { text-align: left; }
    }
  `;
}

function payslipHeaderHtml(input: {
  shop: PayrollPaymentDocShop;
  docNo: string;
  periodLabel: string;
  paidDateShort: string;
}): string {
  const metaBits = [
    input.shop.shopAddress,
    input.shop.shopPhone ? `โทรศัพท์ ${input.shop.shopPhone}` : "",
    input.shop.taxId ? `เลขประจำตัวผู้เสียภาษี ${input.shop.taxId}` : "",
  ].filter(Boolean);
  return `<header class="head">
    <div>
      <h1 class="org-name">${escapeReceiptHtml(input.shop.shopName)}</h1>
      ${
        input.shop.shopNameTh
          ? `<div class="org-name-th">${escapeReceiptHtml(input.shop.shopNameTh)}</div>`
          : ""
      }
      ${
        metaBits.length
          ? `<p class="org-meta">${metaBits.map((b) => escapeReceiptHtml(b)).join("<br/>")}</p>`
          : ""
      }
    </div>
    <div class="doc-meta">
      <div><strong>เลขที่:</strong> ${escapeReceiptHtml(input.docNo)}</div>
      <div><strong>งวดที่จ่าย:</strong> ${escapeReceiptHtml(input.periodLabel)}</div>
      <div><strong>วันที่จ่าย:</strong> ${escapeReceiptHtml(input.paidDateShort)}</div>
    </div>
  </header>`;
}

function payslipEmpHtml(input: {
  recipient: string;
  payer: PayrollPaymentDocPayer;
  bankBits: string[];
  salaryFull?: number;
}): string {
  return `<div class="emp">
    <div><span class="k">ชื่อพนักงาน:</span> <span class="v">${escapeReceiptHtml(input.recipient)}</span></div>
    <div><span class="k">ผู้จ่าย:</span> <span class="v">${escapeReceiptHtml(input.payer.payerName)}${
      input.payer.payerTitle
        ? ` · ${escapeReceiptHtml(input.payer.payerTitle)}`
        : ""
    }</span></div>
    ${
      input.bankBits.length
        ? `<div><span class="k">บัญชีรับโอน:</span> <span class="v">${escapeReceiptHtml(input.bankBits.join(" · "))}</span></div>`
        : `<div><span class="k">บัญชีรับโอน:</span> <span class="v">—</span></div>`
    }
    ${
      input.salaryFull && input.salaryFull > 0
        ? `<div><span class="k">อัตราเงินเดือนเต็ม:</span> <span class="v">${money(input.salaryFull)} บาท</span></div>`
        : ""
    }
  </div>`;
}

function padColRows(count: number, target: number): string {
  const n = Math.max(0, target - count);
  return Array.from({ length: n }, () => `<tr><td class="desc pad">&nbsp;</td><td class="num pad">&nbsp;</td></tr>`).join("");
}

function payslipIncomeDeductHtml(input: {
  incomeRows: { label: string; amount: number }[];
  incomeTotal: number;
  deductRows: { label: string; amount: number; note?: string }[];
  deductTotal: number;
  paidDateShort: string;
  transferTotal: number;
}): string {
  const rowTarget = Math.max(input.incomeRows.length, input.deductRows.length, 4);
  const incomeBody = input.incomeRows
    .map(
      (r) => `<tr><td class="desc">${escapeReceiptHtml(r.label)}</td><td class="num">${money(r.amount)}</td></tr>`,
    )
    .join("");
  const deductBody = input.deductRows
    .map(
      (r) => `<tr><td class="desc">${escapeReceiptHtml(r.label)}${
        r.note
          ? `<div class="tiny muted">${escapeReceiptHtml(r.note)}</div>`
          : ""
      }</td><td class="num">${money(r.amount)}</td></tr>`,
    )
    .join("");
  return `<div class="main">
    <div class="col-wrap">
      <table class="col">
        <thead><tr><th colspan="2">รายได้</th></tr></thead>
        <tbody>
          ${incomeBody}
          ${padColRows(input.incomeRows.length, rowTarget)}
          <tr class="foot"><td>รวมรายได้</td><td class="num">${money(input.incomeTotal)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="col-wrap">
      <table class="col">
        <thead><tr><th colspan="2">รายการหัก</th></tr></thead>
        <tbody>
          ${
            deductBody ||
            `<tr><td class="desc muted">ไม่มีรายการหัก</td><td class="num">0.00</td></tr>`
          }
          ${padColRows(
            input.deductRows.length > 0 ? input.deductRows.length : 1,
            rowTarget,
          )}
          <tr class="foot"><td>รวมรายการหัก</td><td class="num">${money(input.deductTotal)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="side">
      <div class="box">
        <p class="lbl">วันที่จ่าย</p>
        <p class="val">${escapeReceiptHtml(input.paidDateShort)}</p>
      </div>
      <div class="box net">
        <p class="lbl">ยอดโอนรอบนี้</p>
        <p class="val">${money(input.transferTotal)}</p>
        <p class="sub">เข้าบัญชีในรอบนี้<br/>ยังไม่นับเงินเบิกที่โอนให้ไปก่อน (ถ้ามี)</p>
      </div>
    </div>
  </div>`;
}

function payslipBottomHtml(input: {
  incomeTotal: number;
  advancePaidEarlier: number;
  transferTotal: number;
  payer: PayrollPaymentDocPayer;
  recipient: string;
  formalDate: string;
  footNote: string;
}): string {
  const totalReceived = round2(input.advancePaidEarlier + input.transferTotal);
  const advanceBlock =
    input.advancePaidEarlier > 0
      ? `<table>
        <tr>
          <td>เงินเบิกล่วงหน้าที่โอนให้ไปแล้ว</td>
          <td class="num">${money(input.advancePaidEarlier)}</td>
        </tr>
        <tr>
          <td>ยอดโอนเข้าบัญชีรอบนี้</td>
          <td class="num">${money(input.transferTotal)}</td>
        </tr>
        <tr class="total">
          <td>รวมเงินที่พนักงานได้รับทั้งงวด</td>
          <td class="num">${money(totalReceived)}</td>
        </tr>
      </table>
      <p class="note">รวมที่ได้รับทั้งงวด = รวมรายได้ (${money(input.incomeTotal)}) · รายการหัก「คืนเบิกล่วงหน้า」คือเงินที่โอนให้ไปก่อนแล้ว ไม่โอนซ้ำในรอบนี้ — ไม่ใช่การลดอัตราค่าจ้าง</p>`
      : `<table>
        <tr class="total">
          <td>รวมเงินที่พนักงานได้รับทั้งงวด</td>
          <td class="num">${money(input.transferTotal)}</td>
        </tr>
      </table>
      <p class="note">ไม่มีรายการเบิกล่วงหน้าในงวดนี้ · ยอดโอนรอบนี้เท่ากับรวมรายได้</p>`;

  return `<div class="clarify">${advanceBlock}</div>
  <div class="words">
    <span class="k">ยอดโอนรอบนี้ (ตัวอักษร)</span>
    ${escapeReceiptHtml(thaiBahtText(input.transferTotal))}
  </div>
  <div class="signs">
    <div class="sign">
      <div class="cap">ผู้จ่ายเงิน</div>
      <div class="blank"></div>
      <div class="name">(${escapeReceiptHtml(input.payer.payerName)})</div>
      ${
        input.payer.payerTitle
          ? `<div class="role">${escapeReceiptHtml(input.payer.payerTitle)}</div>`
          : ""
      }
      <div class="date-line">${escapeReceiptHtml(input.formalDate)}</div>
    </div>
    <div class="sign">
      <div class="cap">ลงชื่อผู้รับเงิน</div>
      <div class="blank"></div>
      <div class="name">(${escapeReceiptHtml(input.recipient)})</div>
      <div class="role">ชื่อจริง–นามสกุล</div>
      <div class="date-line">วันที่ ...... / ...... / ..........</div>
    </div>
  </div>
  <div class="foot">
    <div>เอกสารภายในกิจการ ขนาด A4 · หลักฐานการจ่ายค่าจ้าง/เงินเดือน — ไม่ใช่หนังสือรับรองหักภาษี ณ ที่จ่าย (แบบ ๕๐ ทวิ) และไม่ใช่ใบเสร็จรับเงิน</div>
    <div>${escapeReceiptHtml(input.footNote)}</div>
  </div>`;
}

function paidDateShortFromMs(ms: number): string {
  if (!ms) return "—";
  const p = bangkokDatePartsBe(ms);
  if (!p) return "—";
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.yearBe}`;
}

function periodDocLabel(periodMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((periodMonth || "").trim());
  if (!m) return periodMonth || "—";
  return `${m[2]}/${Number(m[1]) + 543}`;
}

function buildMonthPaymentDocSheetHtml(input: {
  summary: PayrollMonthPaymentSummary;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer: PayrollPaymentDocPayer;
}): string {
  const { summary, shop, payee, payer } = input;
  const recipient = legalNameForPaymentDoc(payee);
  const formalDate = formatPayrollFormalDate(summary.paidAt || Date.now());
  const paidDateShort = paidDateShortFromMs(summary.paidAt);
  const docNo = payrollPaymentDocNo({
    periodMonth: summary.periodMonth,
    employeeId: summary.employeeId,
    paidAt: summary.paidAt,
  });
  const bankBits = [payee.payBank, payee.payAccountNo].filter(Boolean) as string[];

  const incomeRows: { label: string; amount: number }[] = [];
  if (summary.midGross > 0 || summary.midAdvance > 0) {
    incomeRows.push({ label: "ค่าจ้างกลางเดือน", amount: summary.midGross });
  }
  if (summary.endGross > 0 || summary.endAdvance > 0) {
    incomeRows.push({ label: "ค่าจ้างสิ้นเดือน", amount: summary.endGross });
  }
  if (summary.specialGross > 0 || summary.specialAdvance > 0) {
    incomeRows.push({ label: "ค่าจ้างจ่ายแยก", amount: summary.specialGross });
  }
  if (summary.bonusGross > 0 || summary.bonusAdvance > 0) {
    incomeRows.push({ label: "โบนัส", amount: summary.bonusGross });
  }
  const incomeTotal = round2(
    incomeRows.reduce((s, r) => s + r.amount, 0) || summary.grossTotal,
  );

  const deductRows: { label: string; amount: number; note?: string }[] = [];
  if (summary.advanceDeductTotal > 0) {
    deductRows.push({
      label: "คืนเบิกล่วงหน้า",
      amount: summary.advanceDeductTotal,
      note: "โอนให้ไปก่อนแล้ว — ไม่ใช่ลดเงินเดือน",
    });
  }

  const slipNote = summary.slipUrls.length
    ? `มีหลักฐานการโอนเงินแนบในระบบ ${summary.slipUrls.length} รายการ · ${summary.periodMonth}`
    : `อ้างอิงงวด ${summary.periodMonth}`;

  return `<div class="sheet">
    ${payslipHeaderHtml({
      shop,
      docNo,
      periodLabel: periodDocLabel(summary.periodMonth),
      paidDateShort,
    })}
    ${payslipEmpHtml({
      recipient,
      payer,
      bankBits,
      salaryFull: summary.salaryFull,
    })}
    ${payslipIncomeDeductHtml({
      incomeRows,
      incomeTotal,
      deductRows,
      deductTotal: summary.advanceDeductTotal,
      paidDateShort,
      transferTotal: summary.transferTotal,
    })}
    ${payslipBottomHtml({
      incomeTotal,
      advancePaidEarlier: summary.advanceDeductTotal,
      transferTotal: summary.transferTotal,
      payer,
      recipient,
      formalDate,
      footNote: slipNote,
    })}
  </div>`;
}

function buildPaymentDocSheetHtml(input: {
  receipt: StaffTransferReceipt;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer?: PayrollPaymentDocPayer;
}): string {
  const { receipt, shop, payee } = input;
  const payer = input.payer || {
    payerName: "พีระพงษ์ โยหาเคน",
    payerTitle: "เจ้าของกิจการ",
  };
  const recipient = legalNameForPaymentDoc(payee);
  const formalDate = formatPayrollFormalDate(receipt.paidAt || Date.now());
  const paidDateShort = paidDateShortFromMs(receipt.paidAt);
  const empId = receipt.lines[0]?.item.employeeId || "";
  const docNo = payrollPaymentDocNo({
    periodMonth: receipt.periodMonth,
    employeeId: empId,
    paidAt: receipt.paidAt,
  });
  const bankBits = [payee.payBank, payee.payAccountNo].filter(Boolean) as string[];

  const incomeRows = receipt.lines.map((line) => {
    const gross =
      line.grossAmount > 0
        ? round2(line.grossAmount)
        : round2(line.amount + line.advanceDeduct);
    return {
      label: shortTransferKindLabel(line.kind),
      amount: gross,
    };
  });
  const incomeTotal = round2(incomeRows.reduce((s, r) => s + r.amount, 0));
  const deductRows: { label: string; amount: number; note?: string }[] = [];
  if (receipt.advanceDeductTotal > 0) {
    deductRows.push({
      label: "คืนเบิกล่วงหน้า",
      amount: receipt.advanceDeductTotal,
      note: "โอนให้ไปก่อนแล้ว — ไม่ใช่ลดเงินเดือน",
    });
  }

  const slipNote = receipt.slipUrls.length
    ? `มีหลักฐานการโอนเงินแนบในระบบ ${receipt.slipUrls.length} รายการ · อ้างอิง ${receipt.key}`
    : `อ้างอิง ${receipt.key}`;

  const salaryFull = Math.max(
    0,
    ...receipt.lines.map((l) => round2(l.item.salaryBase || 0)),
  );

  return `<div class="sheet">
    ${payslipHeaderHtml({
      shop,
      docNo,
      periodLabel: periodDocLabel(receipt.periodMonth),
      paidDateShort,
    })}
    ${payslipEmpHtml({
      recipient,
      payer,
      bankBits,
      salaryFull: salaryFull > 0 ? salaryFull : undefined,
    })}
    ${payslipIncomeDeductHtml({
      incomeRows,
      incomeTotal,
      deductRows,
      deductTotal: receipt.advanceDeductTotal,
      paidDateShort,
      transferTotal: receipt.transferTotal,
    })}
    ${payslipBottomHtml({
      incomeTotal,
      advancePaidEarlier: receipt.advanceDeductTotal,
      transferTotal: receipt.transferTotal,
      payer,
      recipient,
      formalDate,
      footNote: slipNote,
    })}
  </div>`;
}

function wrapPaymentDocHtml(input: {
  title: string;
  bodyInner: string;
  multiPage?: boolean;
  autoPrint?: boolean;
}): string {
  const autoPrintScript = input.autoPrint
    ? `<script>
      window.addEventListener("load", function () {
        setTimeout(function () { window.focus(); window.print(); }, 400);
      });
    </script>`
    : "";
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeReceiptHtml(input.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>${paymentDocCss(Boolean(input.multiPage))}</style>
</head>
<body>
  ${input.bodyInner}
  ${autoPrintScript}
</body>
</html>`;
}

export function buildPayrollPaymentDocHtml(input: {
  receipt: StaffTransferReceipt;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer?: PayrollPaymentDocPayer;
  /** ใส่สคริปต์สั่งพิมพ์อัตโนมัติเมื่อเปิดหน้าต่างพิมพ์ */
  autoPrint?: boolean;
}): string {
  const periodLabel = formatPayrollPeriodLabel(input.receipt.periodMonth);
  const title = `หลักฐานการจ่ายค่าจ้าง · ${legalNameForPaymentDoc(input.payee)} · ${periodLabel}`;
  return wrapPaymentDocHtml({
    title,
    bodyInner: buildPaymentDocSheetHtml(input),
    autoPrint: input.autoPrint,
  });
}

export function monthPaymentDocFilename(
  summary: PayrollMonthPaymentSummary,
  payee?: PayrollPaymentDocPayee,
): string {
  const name =
    (payee
      ? legalNameForPaymentDoc(payee)
      : "—"
    )
      .replace(/\s+/g, "_")
      .replace(/[^\w\u0E00-\u0E7F_-]+/g, "") || "staff";
  return `หลักฐานจ่าย_${summary.periodMonth}_${name}.html`;
}

export function monthPaymentDocsBundleFilename(periodMonth: string): string {
  return `หลักฐานจ่าย_${periodMonth || "month"}_ทั้งร้าน.html`;
}

export function buildMonthPaymentDocHtml(input: {
  summary: PayrollMonthPaymentSummary;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer: PayrollPaymentDocPayer;
  autoPrint?: boolean;
}): string {
  const periodLabel = formatPayrollPeriodLabel(input.summary.periodMonth);
  const title = `หลักฐานการจ่ายค่าจ้าง · ${legalNameForPaymentDoc(input.payee)} · ${periodLabel}`;
  return wrapPaymentDocHtml({
    title,
    bodyInner: buildMonthPaymentDocSheetHtml(input),
    autoPrint: input.autoPrint,
  });
}

/** รวมเอกสารรายเดือนทุกคน (กลางเดือน + สิ้นเดือน + โบนัส) · A4 หลายหน้า */
export function buildMonthPaymentDocsBundleHtml(input: {
  periodMonth: string;
  summaries: PayrollMonthPaymentSummary[];
  shop: PayrollPaymentDocShop;
  payer: PayrollPaymentDocPayer;
  payeeFor: (summary: PayrollMonthPaymentSummary) => PayrollPaymentDocPayee;
  autoPrint?: boolean;
}): string {
  const periodLabel = formatPayrollPeriodLabel(input.periodMonth);
  const periodFull = formatPayrollPeriodLabelFull(input.periodMonth);
  const sheets = input.summaries
    .map((summary) =>
      buildMonthPaymentDocSheetHtml({
        summary,
        shop: input.shop,
        payee: input.payeeFor(summary),
        payer: input.payer,
      }),
    )
    .join("\n");
  const cover = `<div class="bundle-cover">
    <p class="org">${escapeReceiptHtml(input.shop.shopName)}</p>
    <p class="title">ชุดหลักฐานการจ่ายค่าจ้างและเงินเดือน</p>
    <p class="meta">งวด ${escapeReceiptHtml(periodFull)} · ทั้งหมด ${input.summaries.length} คน · พิมพ์/บันทึก PDF แบบ A4 ได้ทั้งชุด</p>
  </div>`;
  return wrapPaymentDocHtml({
    title: `หลักฐานจ่ายทั้งร้าน · ${periodLabel}`,
    bodyInner: `${cover}\n${sheets}`,
    multiPage: true,
    autoPrint: input.autoPrint,
  });
}

export function openMonthPaymentDoc(input: {
  summary: PayrollMonthPaymentSummary;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer: PayrollPaymentDocPayer;
}): boolean {
  const html = buildMonthPaymentDocHtml({ ...input, autoPrint: true });
  return openPayrollPaymentDocPrint(html);
}

export function downloadMonthPaymentDoc(input: {
  summary: PayrollMonthPaymentSummary;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer: PayrollPaymentDocPayer;
}): boolean {
  const html = buildMonthPaymentDocHtml({ ...input, autoPrint: false });
  return downloadPayrollPaymentDocHtml(
    html,
    monthPaymentDocFilename(input.summary, input.payee),
  );
}

export function openMonthPaymentDocsBundle(input: {
  periodMonth: string;
  summaries: PayrollMonthPaymentSummary[];
  shop: PayrollPaymentDocShop;
  payer: PayrollPaymentDocPayer;
  payeeFor: (summary: PayrollMonthPaymentSummary) => PayrollPaymentDocPayee;
}): boolean {
  if (!input.summaries.length) return false;
  const html = buildMonthPaymentDocsBundleHtml({ ...input, autoPrint: true });
  return openPayrollPaymentDocPrint(html);
}

export function downloadMonthPaymentDocsBundle(input: {
  periodMonth: string;
  summaries: PayrollMonthPaymentSummary[];
  shop: PayrollPaymentDocShop;
  payer: PayrollPaymentDocPayer;
  payeeFor: (summary: PayrollMonthPaymentSummary) => PayrollPaymentDocPayee;
}): boolean {
  if (!input.summaries.length) return false;
  const html = buildMonthPaymentDocsBundleHtml({
    ...input,
    autoPrint: false,
  });
  return downloadPayrollPaymentDocHtml(
    html,
    monthPaymentDocsBundleFilename(input.periodMonth),
  );
}

/** @deprecated ใช้ listMonthPaymentSummaries */
export function listMonthEndPaymentReceipts(
  items: PayrollItem[],
  periodMonth: string,
): StaffTransferReceipt[] {
  const month = (periodMonth || "").trim();
  if (!month) return [];
  const paid = items.filter(
    (i) => i.periodMonth === month && i.status === "paid",
  );
  return buildStaffTransferReceipts(paid);
}

export function openPayrollPaymentDocPrint(html: string): boolean {
  if (typeof window === "undefined" || typeof window.print !== "function") {
    return false;
  }
  const win = window.open("", "_blank", "width=820,height=960");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

/** ดาวน์โหลดไฟล์ HTML พิมพ์ได้ — เก็บ/แชร์ได้ และเปิดแล้วพิมพ์เป็น PDF ได้ */
export function downloadPayrollPaymentDocHtml(
  html: string,
  filename: string,
): boolean {
  if (typeof document === "undefined") return false;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".html") ? filename : `${filename}.html`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export function printPayrollPaymentDoc(input: {
  receipt: StaffTransferReceipt;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer?: PayrollPaymentDocPayer;
}): boolean {
  const html = buildPayrollPaymentDocHtml({ ...input, autoPrint: true });
  return openPayrollPaymentDocPrint(html);
}

export function downloadPayrollPaymentDoc(input: {
  receipt: StaffTransferReceipt;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer?: PayrollPaymentDocPayer;
}): boolean {
  const html = buildPayrollPaymentDocHtml({ ...input, autoPrint: false });
  return downloadPayrollPaymentDocHtml(
    html,
    payrollPaymentDocFilename(input.receipt),
  );
}
