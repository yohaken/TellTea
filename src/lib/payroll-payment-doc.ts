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
  /** ชื่อแสดงสำรอง (ชื่อในร้าน) */
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
    @page { size: A4; margin: 18mm 16mm 18mm 18mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Sarabun", "TH Sarabun New", "Cordia New", "Angsana New", "Tahoma", sans-serif;
      color: #111;
      background: #fff;
      font-size: 16px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    .sheet {
      width: 100%;
      max-width: 190mm;
      margin: 0 auto;
      padding: 6px 4px 12px;
    }
    ${
      multiPage
        ? `.sheet + .sheet { page-break-before: always; break-before: page; }
    .bundle-cover {
      max-width: 190mm;
      margin: 0 auto 1.25rem;
      padding: 0.25rem 0 0.85rem;
      border-bottom: 1px solid #222;
      text-align: center;
    }
    .bundle-cover .org { font-size: 1.25rem; font-weight: 700; margin: 0; }
    .bundle-cover .title { font-size: 1.05rem; font-weight: 700; margin: 0.4rem 0 0; }
    .bundle-cover .meta { margin: 0.25rem 0 0; font-size: 0.92rem; color: #333; }`
        : ""
    }
    .letterhead { text-align: center; margin: 0 0 0.35rem; }
    .org-name {
      font-size: 1.55rem;
      font-weight: 700;
      margin: 0;
      letter-spacing: 0.02em;
      line-height: 1.25;
    }
    .org-name-th {
      font-size: 1.15rem;
      font-weight: 600;
      margin: 0.1rem 0 0.35rem;
    }
    .org-meta {
      font-size: 0.92rem;
      color: #222;
      line-height: 1.45;
      margin: 0;
    }
    .rule {
      border: 0;
      border-top: 2.2px solid #111;
      border-bottom: 0.7px solid #111;
      height: 4px;
      margin: 0.65rem 0 0.85rem;
    }
    .doc-title {
      text-align: center;
      font-size: 1.35rem;
      font-weight: 700;
      margin: 0;
      letter-spacing: 0.02em;
      text-decoration: underline;
      text-underline-offset: 0.18em;
    }
    .doc-subtitle {
      text-align: center;
      font-size: 0.95rem;
      margin: 0.3rem 0 0.85rem;
      color: #222;
    }
    .doc-ref {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 0.85rem;
      font-size: 0.95rem;
    }
    .doc-ref td { padding: 0.15rem 0.25rem; vertical-align: top; }
    .doc-ref .lbl { width: 3.8rem; color: #333; white-space: nowrap; }
    .doc-ref .val { font-weight: 600; }
    .doc-ref .right { text-align: right; }
    .body-text {
      margin: 0 0 0.9rem;
      text-align: justify;
      text-indent: 2.5rem;
      font-size: 1rem;
      line-height: 1.65;
    }
    .sec {
      font-weight: 700;
      margin: 1rem 0 0.4rem;
      font-size: 1rem;
    }
    .muted { color: #444; }
    .tiny { font-size: 0.88rem; }
    table.info, table.items {
      width: 100%;
      border-collapse: collapse;
      margin: 0.2rem 0 0.55rem;
      font-size: 0.96rem;
    }
    table.info th, table.info td,
    table.items th, table.items td {
      border: 1px solid #222;
      padding: 0.4rem 0.5rem;
      vertical-align: top;
      text-align: left;
    }
    table.info th {
      width: 28%;
      background: #f3f3f3;
      font-weight: 600;
    }
    table.items thead th {
      background: #f3f3f3;
      font-weight: 700;
      text-align: center;
    }
    table.items td.no { width: 3rem; text-align: center; }
    table.items td.num, table.items th.num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      width: 7.5rem;
    }
    table.items td.desc .sub {
      display: block;
      margin-top: 0.15rem;
      font-size: 0.86rem;
      color: #444;
    }
    table.sum {
      width: 100%;
      border-collapse: collapse;
      margin: 0.15rem 0 0.55rem;
      font-size: 0.96rem;
    }
    table.sum td {
      border: 1px solid #222;
      padding: 0.4rem 0.5rem;
    }
    table.sum td.lbl { font-weight: 600; }
    table.sum td.num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      width: 7.5rem;
    }
    table.sum tr.grand td {
      font-weight: 700;
      font-size: 1.05rem;
      background: #f7f7f7;
    }
    .words {
      margin: 0.35rem 0 0.85rem;
      padding: 0.55rem 0.65rem;
      border: 1px solid #222;
      font-size: 0.98rem;
      line-height: 1.5;
    }
    .words .k { font-weight: 700; }
    .cert {
      margin: 0.25rem 0 0.5rem;
      text-align: justify;
      text-indent: 2.5rem;
      font-size: 0.98rem;
      line-height: 1.65;
    }
    .signs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2.5rem;
      margin-top: 1.75rem;
    }
    .sign {
      text-align: center;
      font-size: 0.95rem;
    }
    .sign .cap { font-weight: 700; margin-bottom: 0.35rem; }
    .sign .blank {
      margin: 2.1rem 1.1rem 0.35rem;
      border-bottom: 1px solid #222;
      height: 0;
    }
    .sign .name { margin-top: 0.2rem; font-weight: 600; }
    .sign .role { color: #333; font-size: 0.9rem; margin-top: 0.1rem; }
    .sign .date-line { margin-top: 0.85rem; color: #333; font-size: 0.9rem; }
    .foot {
      margin-top: 1.5rem;
      padding-top: 0.65rem;
      border-top: 1px solid #999;
      font-size: 0.82rem;
      color: #444;
      line-height: 1.45;
    }
    @media print {
      body { margin: 0; background: #fff; }
      .sheet { padding: 0; max-width: none; }
      .bundle-cover { display: none; }
      a { color: inherit; text-decoration: none; }
    }
    @media (max-width: 560px) {
      body { font-size: 15px; }
      .signs { grid-template-columns: 1fr; gap: 1.75rem; }
      table.info th { width: 34%; }
    }
  `;
}

function formalLetterheadHtml(shop: PayrollPaymentDocShop): string {
  const metaBits = [
    shop.shopAddress,
    shop.shopPhone ? `โทรศัพท์ ${shop.shopPhone}` : "",
    shop.taxId ? `เลขประจำตัวผู้เสียภาษี ${shop.taxId}` : "",
  ].filter(Boolean);
  return `<header class="letterhead">
    <h1 class="org-name">${escapeReceiptHtml(shop.shopName)}</h1>
    ${
      shop.shopNameTh
        ? `<div class="org-name-th">${escapeReceiptHtml(shop.shopNameTh)}</div>`
        : ""
    }
    ${
      metaBits.length
        ? `<p class="org-meta">${metaBits.map((b) => escapeReceiptHtml(b)).join("<br/>")}</p>`
        : ""
    }
  </header>
  <hr class="rule" />`;
}

function formalSignsHtml(input: {
  payer: PayrollPaymentDocPayer;
  recipient: string;
  formalDate: string;
}): string {
  return `<div class="signs">
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
      <div class="cap">ผู้รับเงิน</div>
      <div class="blank"></div>
      <div class="name">(${escapeReceiptHtml(input.recipient)})</div>
      <div class="role">พนักงาน / ผู้รับค่าจ้าง</div>
      <div class="date-line">วันที่ ...... / ...... / ..........</div>
    </div>
  </div>`;
}

function buildMonthPaymentDocSheetHtml(input: {
  summary: PayrollMonthPaymentSummary;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer: PayrollPaymentDocPayer;
}): string {
  const { summary, shop, payee, payer } = input;
  const periodFull = formatPayrollPeriodLabelFull(summary.periodMonth);
  const paidLabel = formatPayrollPaidAtLabel(summary.paidAt);
  const formalDate = formatPayrollFormalDate(summary.paidAt || Date.now());
  const recipient = legalFullName(payee);
  const docNo = payrollPaymentDocNo({
    periodMonth: summary.periodMonth,
    employeeId: summary.employeeId,
    paidAt: summary.paidAt,
  });
  const bankBits = [
    payee.payBank,
    payee.payAccountNo,
    payee.payAccountName ? `ชื่อบัญชี ${payee.payAccountName}` : "",
  ].filter(Boolean);

  const itemLines: { label: string; amount: number; sub?: string }[] = [];
  if (summary.midGross > 0 || summary.midAdvance > 0) {
    itemLines.push({
      label: "ค่าจ้างรอบกลางเดือน",
      amount: summary.midGross,
      sub:
        summary.midAdvance > 0
          ? `หักคืนเบิกล่วงหน้าในรายการนี้ ${money(summary.midAdvance)} บาท`
          : undefined,
    });
  }
  if (summary.endGross > 0 || summary.endAdvance > 0) {
    itemLines.push({
      label: "ค่าจ้างรอบสิ้นเดือน",
      amount: summary.endGross,
      sub:
        summary.endAdvance > 0
          ? `หักคืนเบิกล่วงหน้าในรายการนี้ ${money(summary.endAdvance)} บาท`
          : undefined,
    });
  }
  if (summary.specialGross > 0 || summary.specialAdvance > 0) {
    itemLines.push({
      label: "ค่าจ้างจ่ายแยก",
      amount: summary.specialGross,
      sub:
        summary.specialAdvance > 0
          ? `หักคืนเบิกล่วงหน้าในรายการนี้ ${money(summary.specialAdvance)} บาท`
          : undefined,
    });
  }
  if (summary.bonusGross > 0 || summary.bonusAdvance > 0) {
    itemLines.push({
      label: "เงินโบนัส / ค่าตอบแทนอื่น",
      amount: summary.bonusGross,
      sub:
        summary.bonusAdvance > 0
          ? `หักคืนเบิกล่วงหน้าในรายการนี้ ${money(summary.bonusAdvance)} บาท`
          : undefined,
    });
  }

  const rows = itemLines
    .map(
      (line, idx) => `<tr>
      <td class="no">${idx + 1}</td>
      <td class="desc">${escapeReceiptHtml(line.label)}${
        line.sub
          ? `<span class="sub">${escapeReceiptHtml(line.sub)}</span>`
          : ""
      }</td>
      <td class="num">${money(line.amount)}</td>
    </tr>`,
    )
    .join("");

  const shopLine = [shop.shopNameTh, shop.shopName].filter(Boolean).join(" / ");
  const slipNote = summary.slipUrls.length
    ? `มีหลักฐานการโอนเงินแนบในระบบจำนวน ${summary.slipUrls.length} รายการ`
    : "ยังไม่มีการแนบหลักฐานสลิปโอนในระบบ";

  return `<div class="sheet">
    ${formalLetterheadHtml(shop)}
    <h2 class="doc-title">หลักฐานการจ่ายค่าจ้างและเงินเดือน</h2>
    <p class="doc-subtitle">เอกสารภายในกิจการ · ขนาดกระดาษ A4</p>
    <table class="doc-ref">
      <tr>
        <td class="lbl">เลขที่</td>
        <td class="val">${escapeReceiptHtml(docNo)}</td>
        <td class="right muted">${escapeReceiptHtml(formalDate)}</td>
      </tr>
      <tr>
        <td class="lbl">งวด</td>
        <td class="val" colspan="2">${escapeReceiptHtml(periodFull)}</td>
      </tr>
    </table>
    <p class="body-text">
      หนังสือฉบับนี้ขอรับรองว่า ${escapeReceiptHtml(shopLine || shop.shopName)}
      ได้จ่ายค่าจ้าง เงินเดือน และ/หรือค่าตอบแทน ให้แก่
      <strong>${escapeReceiptHtml(recipient)}</strong>
      สำหรับงวด ${escapeReceiptHtml(periodFull)}
      ตามรายการด้านล่าง โดยโอนเข้าบัญชีธนาคารตามที่ระบุ
      และจำนวนเงินสุทธิที่โอนเข้าบัญชีคือยอดหลังหักคืนเบิกล่วงหน้า (ถ้ามี)
      ซึ่งเป็นการชำระหนี้เงินเบิกที่ได้จ่ายให้ล่วงหน้าแล้ว มิใช่การลดอัตราค่าจ้าง
    </p>

    <div class="sec">๑. คู่กรณีและข้อมูลการจ่าย</div>
    <table class="info">
      <tr><th>ผู้รับเงิน (ชื่อจริง–นามสกุล)</th><td>${escapeReceiptHtml(recipient)}</td></tr>
      ${
        payee.employeeName &&
        legalFullName(payee) !== payee.employeeName.trim()
          ? `<tr><th>ชื่อที่ใช้ในกิจการ</th><td>${escapeReceiptHtml(payee.employeeName)}</td></tr>`
          : ""
      }
      ${
        bankBits.length
          ? `<tr><th>บัญชีรับโอน</th><td>${escapeReceiptHtml(bankBits.join(" · "))}</td></tr>`
          : ""
      }
      <tr><th>ผู้จ่ายเงิน</th><td>${escapeReceiptHtml(payer.payerName)}${
        payer.payerTitle
          ? ` · ${escapeReceiptHtml(payer.payerTitle)}`
          : ""
      }</td></tr>
      ${
        summary.salaryFull > 0
          ? `<tr><th>อัตราเงินเดือนเต็ม (อ้างอิง)</th><td>${money(summary.salaryFull)} บาท</td></tr>`
          : ""
      }
      <tr><th>วัน–เวลาโอนล่าสุด</th><td>${escapeReceiptHtml(paidLabel)}</td></tr>
    </table>

    <div class="sec">๒. รายการที่ถึงกำหนดและยอดสุทธิ</div>
    <table class="items">
      <thead>
        <tr>
          <th style="width:3rem">ลำดับ</th>
          <th>รายการ</th>
          <th class="num">จำนวนเงิน (บาท)</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <table class="sum">
      <tr>
        <td class="lbl">รวมก่อนหักคืนเบิก</td>
        <td class="num">${money(summary.grossTotal)}</td>
      </tr>
      ${
        summary.advanceDeductTotal > 0
          ? `<tr>
        <td class="lbl">หัก คืนเบิกล่วงหน้า <span class="muted tiny">(ได้จ่ายให้แล้วมาก่อน)</span></td>
        <td class="num">(${money(summary.advanceDeductTotal)})</td>
      </tr>`
          : ""
      }
      <tr class="grand">
        <td class="lbl">จำนวนเงินสุทธิที่โอนเข้าบัญชี</td>
        <td class="num">${money(summary.transferTotal)}</td>
      </tr>
    </table>
    <div class="words">
      <span class="k">จำนวนเงินสุทธิ (ตัวอักษร)</span>
      ${escapeReceiptHtml(thaiBahtText(summary.transferTotal))}
    </div>

    <div class="sec">๓. การรับรอง</div>
    <p class="cert">
      ข้าพเจ้าในฐานะผู้จ่ายเงินขอรับรองว่าข้อความและจำนวนเงินข้างต้นถูกต้อง
      และได้จ่ายให้แก่ผู้รับเงินจริงตามรายการนี้แล้ว
      ผู้รับเงินลงลายมือชื่อรับรองการได้รับเงินด้านล่าง
    </p>
    ${formalSignsHtml({ payer, recipient, formalDate })}

    <div class="foot">
      <div>หมายเหตุ: เอกสารนี้เป็นหลักฐานการจ่ายค่าจ้าง/เงินเดือนภายในกิจการ — ไม่ใช่หนังสือรับรองการหักภาษี ณ ที่จ่าย (แบบ ๕๐ ทวิ) และไม่ใช่ใบเสร็จรับเงิน</div>
      <div>${escapeReceiptHtml(slipNote)} · อ้างอิง ${escapeReceiptHtml(summary.employeeId)} / ${escapeReceiptHtml(summary.periodMonth)}</div>
    </div>
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
  const periodFull = formatPayrollPeriodLabelFull(receipt.periodMonth);
  const paidLabel = formatPayrollPaidAtLabel(receipt.paidAt);
  const formalDate = formatPayrollFormalDate(receipt.paidAt || Date.now());
  const recipient = legalFullName(payee);
  const empId = receipt.lines[0]?.item.employeeId || "";
  const docNo = payrollPaymentDocNo({
    periodMonth: receipt.periodMonth,
    employeeId: empId,
    paidAt: receipt.paidAt,
  });
  const bankBits = [
    payee.payBank,
    payee.payAccountNo,
    payee.payAccountName ? `ชื่อบัญชี ${payee.payAccountName}` : "",
  ].filter(Boolean);
  const receiptNote = (receipt.note || "").trim();
  const shopLine = [shop.shopNameTh, shop.shopName].filter(Boolean).join(" / ");

  const grossLines = receipt.lines.map((line) => {
    const gross =
      line.grossAmount > 0
        ? round2(line.grossAmount)
        : round2(line.amount + line.advanceDeduct);
    return { line, gross };
  });
  const grossTotal = round2(grossLines.reduce((s, x) => s + x.gross, 0));

  const lineRows = grossLines
    .map(({ line, gross }, idx) => {
      const meta = lineMetaBits(line, receiptNote);
      return `<tr>
        <td class="no">${idx + 1}</td>
        <td class="desc">${escapeReceiptHtml(shortTransferKindLabel(line.kind))}${
          meta.length
            ? `<span class="sub">${escapeReceiptHtml(meta.join(" · "))}</span>`
            : ""
        }</td>
        <td class="num">${money(gross)}</td>
      </tr>`;
    })
    .join("");

  const slipNote = receipt.slipUrls.length
    ? `มีหลักฐานการโอนเงินแนบในระบบจำนวน ${receipt.slipUrls.length} รายการ`
    : "ยังไม่มีการแนบหลักฐานสลิปโอนในระบบ";

  return `<div class="sheet">
    ${formalLetterheadHtml(shop)}
    <h2 class="doc-title">หลักฐานการจ่ายค่าจ้างและเงินเดือน</h2>
    <p class="doc-subtitle">เอกสารภายในกิจการ · ขนาดกระดาษ A4${
      receipt.combined ? " · โอนรวมสิ้นเดือนและโบนัส" : ""
    }</p>
    <table class="doc-ref">
      <tr>
        <td class="lbl">เลขที่</td>
        <td class="val">${escapeReceiptHtml(docNo)}</td>
        <td class="right muted">${escapeReceiptHtml(formalDate)}</td>
      </tr>
      <tr>
        <td class="lbl">งวด</td>
        <td class="val" colspan="2">${escapeReceiptHtml(periodFull)}</td>
      </tr>
    </table>
    <p class="body-text">
      หนังสือฉบับนี้ขอรับรองว่า ${escapeReceiptHtml(shopLine || shop.shopName)}
      ได้จ่ายค่าจ้าง เงินเดือน และ/หรือค่าตอบแทน ให้แก่
      <strong>${escapeReceiptHtml(recipient)}</strong>
      สำหรับงวด ${escapeReceiptHtml(periodFull)}
      ตามรายการด้านล่าง โดยโอนเข้าบัญชีธนาคารตามที่ระบุแล้ว
      ${
        receiptNote
          ? ` หมายเหตุการจ่าย: ${escapeReceiptHtml(receiptNote)}`
          : ""
      }
    </p>

    <div class="sec">๑. คู่กรณีและข้อมูลการจ่าย</div>
    <table class="info">
      <tr><th>ผู้รับเงิน (ชื่อจริง–นามสกุล)</th><td>${escapeReceiptHtml(recipient)}</td></tr>
      ${
        payee.employeeName &&
        legalFullName(payee) !== payee.employeeName.trim()
          ? `<tr><th>ชื่อที่ใช้ในกิจการ</th><td>${escapeReceiptHtml(payee.employeeName)}</td></tr>`
          : ""
      }
      ${
        bankBits.length
          ? `<tr><th>บัญชีรับโอน</th><td>${escapeReceiptHtml(bankBits.join(" · "))}</td></tr>`
          : ""
      }
      <tr><th>ผู้จ่ายเงิน</th><td>${escapeReceiptHtml(payer.payerName)}${
        payer.payerTitle
          ? ` · ${escapeReceiptHtml(payer.payerTitle)}`
          : ""
      }</td></tr>
      <tr><th>วัน–เวลาโอน</th><td>${escapeReceiptHtml(paidLabel)}</td></tr>
    </table>

    <div class="sec">๒. รายการที่จ่าย</div>
    <table class="items">
      <thead>
        <tr>
          <th style="width:3rem">ลำดับ</th>
          <th>รายการ</th>
          <th class="num">จำนวนเงิน (บาท)</th>
        </tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>
    <table class="sum">
      <tr>
        <td class="lbl">รวมก่อนหักคืนเบิก</td>
        <td class="num">${money(grossTotal)}</td>
      </tr>
      ${
        receipt.advanceDeductTotal > 0
          ? `<tr>
        <td class="lbl">หัก คืนเบิกล่วงหน้า <span class="muted tiny">(ได้จ่ายให้แล้วมาก่อน)</span></td>
        <td class="num">(${money(receipt.advanceDeductTotal)})</td>
      </tr>`
          : ""
      }
      <tr class="grand">
        <td class="lbl">จำนวนเงินสุทธิที่โอนเข้าบัญชี</td>
        <td class="num">${money(receipt.transferTotal)}</td>
      </tr>
    </table>
    <div class="words">
      <span class="k">จำนวนเงินสุทธิ (ตัวอักษร)</span>
      ${escapeReceiptHtml(thaiBahtText(receipt.transferTotal))}
    </div>

    <div class="sec">๓. การรับรอง</div>
    <p class="cert">
      ข้าพเจ้าในฐานะผู้จ่ายเงินขอรับรองว่าข้อความและจำนวนเงินข้างต้นถูกต้อง
      และได้จ่ายให้แก่ผู้รับเงินจริงตามรายการนี้แล้ว
      ผู้รับเงินลงลายมือชื่อรับรองการได้รับเงินด้านล่าง
    </p>
    ${formalSignsHtml({ payer, recipient, formalDate })}

    <div class="foot">
      <div>หมายเหตุ: เอกสารนี้เป็นหลักฐานการจ่ายค่าจ้าง/เงินเดือนภายในกิจการ — ไม่ใช่หนังสือรับรองการหักภาษี ณ ที่จ่าย (แบบ ๕๐ ทวิ) และไม่ใช่ใบเสร็จรับเงิน</div>
      <div>${escapeReceiptHtml(slipNote)} · อ้างอิง ${escapeReceiptHtml(receipt.key)}</div>
    </div>
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
  const title = `หลักฐานการจ่ายค่าจ้าง · ${legalFullName(input.payee)} · ${periodLabel}`;
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
    (payee ? legalFullName(payee) : summary.employeeName)
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
  const title = `หลักฐานการจ่ายค่าจ้าง · ${legalFullName(input.payee)} · ${periodLabel}`;
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
