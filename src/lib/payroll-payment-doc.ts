/**
 * ใบสรุปหลักฐานการจ่ายเงินเดือน/โบนัส — ออกอัตโนมัติหลังโอน
 * ดูในแอป · พิมพ์ · บันทึก PDF (ผ่านกล่องพิมพ์เบราว์เซอร์) · ดาวน์โหลด HTML เก็บไว้
 */
import { escapeReceiptHtml } from "./pos-printer/receipt-template";
import type { PosShopSettings } from "./pos-settings";
import {
  buildStaffTransferReceipts,
  shortTransferKindLabel,
  type StaffTransferReceipt,
} from "./payroll-staff-receipt";
import type { PayrollItem } from "./payroll";
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
  /** เงินเดือนเต็มต่อเดือน (จาก snapshot) */
  salaryFull: number;
  midAmount: number;
  midAdvance: number;
  endAmount: number;
  endAdvance: number;
  specialAmount: number;
  specialAdvance: number;
  bonusAmount: number;
  bonusAdvance: number;
  transferTotal: number;
  advanceDeductTotal: number;
  paidAt: number;
  slipUrls: string[];
  items: PayrollItem[];
};

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
  let endAmount = 0;
  let endAdvance = 0;
  let specialAmount = 0;
  let specialAdvance = 0;
  let bonusAmount = 0;
  let bonusAdvance = 0;
  for (const row of paid) {
    if (row.kind === "salary_mid" || row.kind === "salary_month_end") {
      salaryFull = Math.max(salaryFull, round2(row.salaryBase || 0));
    }
    if (row.kind === "salary_mid") {
      midAmount = round2(midAmount + row.amount);
      midAdvance = round2(midAdvance + row.advanceDeduct);
    } else if (row.kind === "salary_month_end") {
      endAmount = round2(endAmount + row.amount);
      endAdvance = round2(endAdvance + row.advanceDeduct);
    } else if (row.kind === "salary_special") {
      specialAmount = round2(specialAmount + row.amount);
      specialAdvance = round2(specialAdvance + row.advanceDeduct);
    } else if (row.kind === "bonus") {
      bonusAmount = round2(bonusAmount + row.amount);
      bonusAdvance = round2(bonusAdvance + row.advanceDeduct);
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
  return {
    employeeId: empId,
    employeeName: paid[0]?.employeeName || "—",
    periodMonth: month,
    salaryFull,
    midAmount,
    midAdvance,
    endAmount,
    endAdvance,
    specialAmount,
    specialAdvance,
    bonusAmount,
    bonusAdvance,
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
  return `ใบสรุปจ่าย_${month}_${name}_${stamp}.html`;
}

function lineMetaBits(
  line: StaffTransferReceipt["lines"][number],
  receiptNote: string,
): string[] {
  const meta: string[] = [];
  if (line.grossAmount > 0 && round2(line.grossAmount) !== round2(line.amount)) {
    meta.push(`ก่อนหักเบิก ฿${money(line.grossAmount)}`);
  }
  if (line.advanceDeduct > 0) {
    meta.push(`หักเบิก ฿${money(line.advanceDeduct)}`);
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
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Sarabun", "Leelawadee UI", "Cordia New", "Tahoma", sans-serif;
      color: #111;
      background: #fff;
      font-size: 15px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .sheet {
      max-width: 720px;
      margin: 0 auto;
      padding: 8px 8px 20px;
    }
    ${
      multiPage
        ? `.sheet + .sheet { page-break-before: always; break-before: page; margin-top: 2rem; padding-top: 1rem; border-top: 1px dashed #ccc; }
    @media print {
      .sheet + .sheet { margin-top: 0; padding-top: 0; border-top: 0; }
    }`
        : ""
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1.25rem;
      padding-bottom: 0.85rem;
      border-bottom: 2px solid #1a1a1a;
    }
    .brand-block { min-width: 0; flex: 1; }
    .brand {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      margin: 0 0 0.1rem;
      line-height: 1.2;
    }
    .brand-th {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 0 0 0.4rem;
      color: #222;
    }
    .shop-meta {
      color: #444;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .doc-stamp {
      text-align: right;
      flex: 0 0 auto;
      max-width: 42%;
    }
    .doc-stamp .label {
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #555;
      margin: 0 0 0.2rem;
    }
    .doc-stamp .name {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0;
      line-height: 1.25;
    }
    .doc-stamp .sub {
      margin: 0.25rem 0 0;
      font-size: 0.85rem;
      color: #555;
    }
    .badge {
      display: inline-block;
      margin-top: 0.35rem;
      padding: 0.12rem 0.45rem;
      border: 1px solid #666;
      border-radius: 3px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .notice {
      margin: 0.65rem 0 0;
      font-size: 0.82rem;
      color: #555;
    }
    .sec {
      font-weight: 700;
      margin: 1.05rem 0 0.4rem;
      font-size: 0.95rem;
      padding-bottom: 0.15rem;
      border-bottom: 1px solid #ddd;
    }
    .muted { color: #555; }
    .tiny { font-size: 0.86rem; }
    .grid {
      display: grid;
      grid-template-columns: 8.5rem 1fr;
      gap: 0.28rem 0.75rem;
      margin: 0.35rem 0 0;
    }
    .grid .k { color: #555; }
    .grid .v { font-weight: 600; word-break: break-word; }
    .grid .v.normal { font-weight: 400; }
    table.pay {
      width: 100%;
      border-collapse: collapse;
      margin: 0.35rem 0 0.4rem;
    }
    table.pay th, table.pay td {
      border-bottom: 1px solid #ddd;
      padding: 0.5rem 0.15rem;
      text-align: left;
      vertical-align: top;
    }
    table.pay th {
      font-size: 0.82rem;
      color: #444;
      font-weight: 700;
    }
    table.pay td.num, table.pay th.num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .line-kind { font-weight: 700; }
    .subtotal {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin: 0.25rem 0;
      font-size: 0.92rem;
      color: #444;
    }
    .total {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-top: 0.55rem;
      padding: 0.55rem 0 0.15rem;
      border-top: 2px solid #1a1a1a;
      font-size: 1.2rem;
      font-weight: 700;
    }
    .signs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      margin-top: 2.25rem;
    }
    .sign {
      text-align: center;
      font-size: 0.9rem;
    }
    .sign .line {
      margin: 2.4rem 1rem 0.35rem;
      border-bottom: 1px solid #333;
      height: 0;
    }
    .sign .role { font-weight: 700; }
    .sign .hint { color: #666; font-size: 0.8rem; margin-top: 0.15rem; }
    .foot {
      margin-top: 1.6rem;
      padding-top: 0.7rem;
      border-top: 1px dashed #bbb;
      font-size: 0.8rem;
      color: #666;
      line-height: 1.4;
    }
    .bundle-cover {
      max-width: 720px;
      margin: 0 auto 1.5rem;
      padding: 0.5rem 0.5rem 1rem;
      border-bottom: 2px solid #1a1a1a;
    }
    @media print {
      body { margin: 0; }
      .sheet { padding: 0; max-width: none; }
      .bundle-cover { display: none; }
      a { color: inherit; text-decoration: none; }
    }
    @media (max-width: 560px) {
      .head { flex-direction: column; }
      .doc-stamp { text-align: left; max-width: none; }
      .signs { grid-template-columns: 1fr; gap: 1.5rem; }
      .grid { grid-template-columns: 7rem 1fr; }
    }
  `;
}

function buildMonthPaymentDocSheetHtml(input: {
  summary: PayrollMonthPaymentSummary;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer: PayrollPaymentDocPayer;
}): string {
  const { summary, shop, payee, payer } = input;
  const periodLabel = formatPayrollPeriodLabel(summary.periodMonth);
  const paidLabel = formatPayrollPaidAtLabel(summary.paidAt);
  const recipient = legalFullName(payee);
  const bankBits = [
    payee.payBank,
    payee.payAccountNo,
    payee.payAccountName ? `ชื่อบัญชี ${payee.payAccountName}` : "",
  ].filter(Boolean);

  const rows: string[] = [];
  if (summary.salaryFull > 0) {
    rows.push(`<tr>
      <td><div class="line-kind">เงินเดือนเต็ม (ต่อเดือน)</div></td>
      <td class="num">฿${money(summary.salaryFull)}</td>
    </tr>`);
  }
  if (summary.midAmount > 0 || summary.midAdvance > 0) {
    rows.push(`<tr>
      <td>
        <div class="line-kind">กลางเดือน</div>
        ${
          summary.midAdvance > 0
            ? `<div class="muted tiny">หักเบิก ฿${money(summary.midAdvance)}</div>`
            : ""
        }
      </td>
      <td class="num">฿${money(summary.midAmount)}</td>
    </tr>`);
  }
  if (summary.endAmount > 0 || summary.endAdvance > 0) {
    rows.push(`<tr>
      <td>
        <div class="line-kind">สิ้นเดือน / เต็มเดือน</div>
        ${
          summary.endAdvance > 0
            ? `<div class="muted tiny">หักเบิก ฿${money(summary.endAdvance)}</div>`
            : ""
        }
      </td>
      <td class="num">฿${money(summary.endAmount)}</td>
    </tr>`);
  }
  if (summary.specialAmount > 0 || summary.specialAdvance > 0) {
    rows.push(`<tr>
      <td>
        <div class="line-kind">จ่ายแยก</div>
        ${
          summary.specialAdvance > 0
            ? `<div class="muted tiny">หักเบิก ฿${money(summary.specialAdvance)}</div>`
            : ""
        }
      </td>
      <td class="num">฿${money(summary.specialAmount)}</td>
    </tr>`);
  }
  if (summary.bonusAmount > 0 || summary.bonusAdvance > 0) {
    rows.push(`<tr>
      <td>
        <div class="line-kind">โบนัส</div>
        ${
          summary.bonusAdvance > 0
            ? `<div class="muted tiny">หักเบิก ฿${money(summary.bonusAdvance)}</div>`
            : ""
        }
      </td>
      <td class="num">฿${money(summary.bonusAmount)}</td>
    </tr>`);
  }

  const slipNote = summary.slipUrls.length
    ? `มีหลักฐานสลิปโอนในระบบ ${summary.slipUrls.length} รูป (ดูได้ที่แท็บหลักฐานจ่ายในแอป)`
    : "ยังไม่มีสลิปโอนแนบในระบบ";

  return `<div class="sheet">
    <header class="head">
      <div class="brand-block">
        <h1 class="brand">${escapeReceiptHtml(shop.shopName)}</h1>
        ${
          shop.shopNameTh
            ? `<p class="brand-th">${escapeReceiptHtml(shop.shopNameTh)}</p>`
            : ""
        }
        <div class="shop-meta">
          ${
            shop.shopAddress
              ? `<div>${escapeReceiptHtml(shop.shopAddress)}</div>`
              : ""
          }
          ${
            shop.shopPhone
              ? `<div>โทร ${escapeReceiptHtml(shop.shopPhone)}</div>`
              : ""
          }
          ${
            shop.taxId
              ? `<div>เลขประจำตัวผู้เสียภาษี ${escapeReceiptHtml(shop.taxId)}</div>`
              : ""
          }
        </div>
      </div>
      <div class="doc-stamp">
        <p class="label">เอกสารจ่าย</p>
        <p class="name">ใบสรุปหลักฐานการจ่าย</p>
        <p class="sub">งวด ${escapeReceiptHtml(periodLabel)}</p>
        <span class="badge">กลางเดือน + สิ้นเดือน + โบนัส</span>
      </div>
    </header>

    <p class="notice">เอกสารภายในกิจการ สำหรับเก็บเป็นหลักฐานการจ่ายเงินเดือน/โบนัส — ไม่ใช่หนังสือรับรองหักภาษี ณ ที่จ่าย (50 ทวิ)</p>

    <div class="sec">ผู้รับเงิน</div>
    <div class="grid">
      <div class="k">ชื่อจริง–นามสกุล</div>
      <div class="v">${escapeReceiptHtml(recipient)}</div>
      ${
        payee.employeeName &&
        legalFullName(payee) !== payee.employeeName.trim()
          ? `<div class="k">ชื่อในร้าน</div><div class="v normal">${escapeReceiptHtml(payee.employeeName)}</div>`
          : ""
      }
      ${
        bankBits.length
          ? `<div class="k">บัญชีรับโอน</div><div class="v normal">${escapeReceiptHtml(bankBits.join(" · "))}</div>`
          : ""
      }
    </div>

    <div class="sec">ผู้จ่าย</div>
    <div class="grid">
      <div class="k">ชื่อผู้จ่าย</div>
      <div class="v">${escapeReceiptHtml(payer.payerName)}</div>
      ${
        payer.payerTitle
          ? `<div class="k">ตำแหน่ง / อื่นๆ</div><div class="v normal">${escapeReceiptHtml(payer.payerTitle)}</div>`
          : ""
      }
    </div>

    <div class="sec">รอบจ่าย</div>
    <div class="grid">
      <div class="k">งวด</div>
      <div class="v">${escapeReceiptHtml(periodLabel)}</div>
      <div class="k">วัน–เวลาโอนล่าสุด</div>
      <div class="v">${escapeReceiptHtml(paidLabel)}</div>
    </div>

    <div class="sec">รายการและยอดรวม</div>
    <table class="pay">
      <thead>
        <tr><th>รายการ</th><th class="num">ยอด (บาท)</th></tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
    ${
      summary.advanceDeductTotal > 0
        ? `<div class="subtotal"><span>หักเบิกรวมทั้งเดือน</span><span>฿${money(summary.advanceDeductTotal)}</span></div>`
        : ""
    }
    <div class="total">
      <span>รวมยอดโอนทั้งหมด</span>
      <span>฿${money(summary.transferTotal)}</span>
    </div>

    <div class="signs">
      <div class="sign">
        <div class="line"></div>
        <div class="role">ผู้จ่าย</div>
        <div class="hint">${escapeReceiptHtml(payer.payerName)}</div>
        ${
          payer.payerTitle
            ? `<div class="hint">${escapeReceiptHtml(payer.payerTitle)}</div>`
            : ""
        }
      </div>
      <div class="sign">
        <div class="line"></div>
        <div class="role">ผู้รับเงิน</div>
        <div class="hint">${escapeReceiptHtml(recipient)}</div>
      </div>
    </div>

    <div class="foot">
      <div>${escapeReceiptHtml(slipNote)}</div>
      <div>ออกจากระบบจ่าย TellTea · ${escapeReceiptHtml(summary.employeeId)} · ${escapeReceiptHtml(summary.periodMonth)}</div>
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
  const periodLabel = formatPayrollPeriodLabel(receipt.periodMonth);
  const paidLabel = formatPayrollPaidAtLabel(receipt.paidAt);
  const recipient = legalFullName(payee);
  const bankBits = [
    payee.payBank,
    payee.payAccountNo,
    payee.payAccountName ? `ชื่อบัญชี ${payee.payAccountName}` : "",
  ].filter(Boolean);
  const receiptNote = (receipt.note || "").trim();

  const lineRows = receipt.lines
    .map((line) => {
      const meta = lineMetaBits(line, receiptNote);
      return `<tr>
        <td>
          <div class="line-kind">${escapeReceiptHtml(shortTransferKindLabel(line.kind))}</div>
          ${
            meta.length
              ? `<div class="muted tiny">${escapeReceiptHtml(meta.join(" · "))}</div>`
              : ""
          }
        </td>
        <td class="num">฿${money(line.amount)}</td>
      </tr>`;
    })
    .join("");

  const slipNote = receipt.slipUrls.length
    ? `มีหลักฐานสลิปโอนในระบบ ${receipt.slipUrls.length} รูป (ดูได้ที่แท็บหลักฐานจ่ายในแอป)`
    : "ยังไม่มีสลิปโอนแนบในระบบ";

  return `<div class="sheet">
    <header class="head">
      <div class="brand-block">
        <h1 class="brand">${escapeReceiptHtml(shop.shopName)}</h1>
        ${
          shop.shopNameTh
            ? `<p class="brand-th">${escapeReceiptHtml(shop.shopNameTh)}</p>`
            : ""
        }
        <div class="shop-meta">
          ${
            shop.shopAddress
              ? `<div>${escapeReceiptHtml(shop.shopAddress)}</div>`
              : ""
          }
          ${
            shop.shopPhone
              ? `<div>โทร ${escapeReceiptHtml(shop.shopPhone)}</div>`
              : ""
          }
          ${
            shop.taxId
              ? `<div>เลขประจำตัวผู้เสียภาษี ${escapeReceiptHtml(shop.taxId)}</div>`
              : ""
          }
        </div>
      </div>
      <div class="doc-stamp">
        <p class="label">เอกสารจ่าย</p>
        <p class="name">ใบสรุปหลักฐานการจ่าย</p>
        <p class="sub">งวด ${escapeReceiptHtml(periodLabel)}</p>
        ${receipt.combined ? `<span class="badge">โอนรวมสิ้นเดือน + โบนัส</span>` : ""}
      </div>
    </header>

    <p class="notice">เอกสารภายในกิจการ สำหรับเก็บเป็นหลักฐานการจ่ายเงินเดือน/โบนัส — ไม่ใช่หนังสือรับรองหักภาษี ณ ที่จ่าย (50 ทวิ)</p>

    <div class="sec">ผู้รับเงิน</div>
    <div class="grid">
      <div class="k">ชื่อจริง–นามสกุล</div>
      <div class="v">${escapeReceiptHtml(recipient)}</div>
      ${
        payee.employeeName &&
        legalFullName(payee) !== payee.employeeName.trim()
          ? `<div class="k">ชื่อในร้าน</div><div class="v normal">${escapeReceiptHtml(payee.employeeName)}</div>`
          : ""
      }
      ${
        bankBits.length
          ? `<div class="k">บัญชีรับโอน</div><div class="v normal">${escapeReceiptHtml(bankBits.join(" · "))}</div>`
          : ""
      }
    </div>

    <div class="sec">ผู้จ่าย</div>
    <div class="grid">
      <div class="k">ชื่อผู้จ่าย</div>
      <div class="v">${escapeReceiptHtml(payer.payerName)}</div>
      ${
        payer.payerTitle
          ? `<div class="k">ตำแหน่ง / อื่นๆ</div><div class="v normal">${escapeReceiptHtml(payer.payerTitle)}</div>`
          : ""
      }
    </div>

    <div class="sec">รอบจ่าย</div>
    <div class="grid">
      <div class="k">งวด</div>
      <div class="v">${escapeReceiptHtml(periodLabel)}</div>
      <div class="k">วัน–เวลาโอน</div>
      <div class="v">${escapeReceiptHtml(paidLabel)}</div>
      ${
        receiptNote
          ? `<div class="k">หมายเหตุ</div><div class="v normal">${escapeReceiptHtml(receiptNote)}</div>`
          : ""
      }
    </div>

    <div class="sec">รายการที่จ่าย</div>
    <table class="pay">
      <thead>
        <tr><th>รายการ</th><th class="num">ยอดโอน (บาท)</th></tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>
    ${
      receipt.advanceDeductTotal > 0
        ? `<div class="subtotal"><span>หักเบิกรวมในรอบนี้</span><span>฿${money(receipt.advanceDeductTotal)}</span></div>`
        : ""
    }
    <div class="total">
      <span>รวมยอดโอนเข้าบัญชี</span>
      <span>฿${money(receipt.transferTotal)}</span>
    </div>

    <div class="signs">
      <div class="sign">
        <div class="line"></div>
        <div class="role">ผู้จ่าย</div>
        <div class="hint">${escapeReceiptHtml(payer.payerName)}</div>
        ${
          payer.payerTitle
            ? `<div class="hint">${escapeReceiptHtml(payer.payerTitle)}</div>`
            : ""
        }
      </div>
      <div class="sign">
        <div class="line"></div>
        <div class="role">ผู้รับเงิน</div>
        <div class="hint">${escapeReceiptHtml(recipient)}</div>
      </div>
    </div>

    <div class="foot">
      <div>${escapeReceiptHtml(slipNote)}</div>
      <div>ออกจากระบบจ่าย TellTea · อ้างอิง ${escapeReceiptHtml(receipt.key)}</div>
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
  const title = `ใบสรุปการจ่าย · ${legalFullName(input.payee)} · ${periodLabel}`;
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
  return `ใบสรุปจ่าย_${summary.periodMonth}_${name}.html`;
}

export function monthPaymentDocsBundleFilename(periodMonth: string): string {
  return `ใบสรุปจ่าย_${periodMonth || "month"}_ทั้งร้าน.html`;
}

export function buildMonthPaymentDocHtml(input: {
  summary: PayrollMonthPaymentSummary;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  payer: PayrollPaymentDocPayer;
  autoPrint?: boolean;
}): string {
  const periodLabel = formatPayrollPeriodLabel(input.summary.periodMonth);
  const title = `ใบสรุปการจ่าย · ${legalFullName(input.payee)} · ${periodLabel}`;
  return wrapPaymentDocHtml({
    title,
    bodyInner: buildMonthPaymentDocSheetHtml(input),
    autoPrint: input.autoPrint,
  });
}

/** รวมใบสรุปรายเดือนทุกคน (กลางเดือน + สิ้นเดือน + โบนัส) */
export function buildMonthPaymentDocsBundleHtml(input: {
  periodMonth: string;
  summaries: PayrollMonthPaymentSummary[];
  shop: PayrollPaymentDocShop;
  payer: PayrollPaymentDocPayer;
  payeeFor: (summary: PayrollMonthPaymentSummary) => PayrollPaymentDocPayee;
  autoPrint?: boolean;
}): string {
  const periodLabel = formatPayrollPeriodLabel(input.periodMonth);
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
    <h1 class="brand" style="font-size:1.35rem;margin:0">${escapeReceiptHtml(input.shop.shopName)}</h1>
    <p style="margin:0.35rem 0 0;font-weight:700">ชุดใบสรุปหลักฐานจ่าย · ${escapeReceiptHtml(periodLabel)}</p>
    <p class="muted tiny" style="margin:0.25rem 0 0">ทั้งหมด ${input.summaries.length} คน · รวมกลางเดือน · สิ้นเดือน · โบนัส · พิมพ์/บันทึก PDF ได้ทั้งชุด</p>
  </div>`;
  return wrapPaymentDocHtml({
    title: `ใบสรุปจ่ายทั้งร้าน · ${periodLabel}`,
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
