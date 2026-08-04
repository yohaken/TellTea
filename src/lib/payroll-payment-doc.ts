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
  employeeName: string;
  payBank?: string;
  payAccountNo?: string;
  payAccountName?: string;
};

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
): PayrollPaymentDocPayee {
  return {
    employeeName:
      (emp?.name || "").trim() || (fallbackName || "").trim() || "—",
    payBank: (emp?.payBank || "").trim() || undefined,
    payAccountNo: (emp?.payAccountNo || "").trim() || undefined,
    payAccountName: (emp?.payAccountName || "").trim() || undefined,
  };
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

export function buildPayrollPaymentDocHtml(input: {
  receipt: StaffTransferReceipt;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  /** ใส่สคริปต์สั่งพิมพ์อัตโนมัติเมื่อเปิดหน้าต่างพิมพ์ */
  autoPrint?: boolean;
}): string {
  const { receipt, shop, payee } = input;
  const periodLabel = formatPayrollPeriodLabel(receipt.periodMonth);
  const title = `ใบสรุปการจ่าย · ${payee.employeeName} · ${periodLabel}`;
  const paidLabel = formatPayrollPaidAtLabel(receipt.paidAt);
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
  <title>${escapeReceiptHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
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
    @media print {
      body { margin: 0; }
      .sheet { padding: 0; max-width: none; }
      a { color: inherit; text-decoration: none; }
    }
    @media (max-width: 560px) {
      .head { flex-direction: column; }
      .doc-stamp { text-align: left; max-width: none; }
      .signs { grid-template-columns: 1fr; gap: 1.5rem; }
      .grid { grid-template-columns: 7rem 1fr; }
    }
  </style>
</head>
<body>
  <div class="sheet">
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
      <div class="k">ชื่อพนักงาน</div>
      <div class="v">${escapeReceiptHtml(payee.employeeName)}</div>
      ${
        bankBits.length
          ? `<div class="k">บัญชีรับโอน</div><div class="v normal">${escapeReceiptHtml(bankBits.join(" · "))}</div>`
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

    <div class="signs" aria-hidden="true">
      <div class="sign">
        <div class="line"></div>
        <div class="role">ผู้จ่าย / ร้าน</div>
        <div class="hint">ลงชื่อ · วันเดือนปี</div>
      </div>
      <div class="sign">
        <div class="line"></div>
        <div class="role">ผู้รับเงิน</div>
        <div class="hint">${escapeReceiptHtml(payee.employeeName)}</div>
      </div>
    </div>

    <div class="foot">
      <div>${escapeReceiptHtml(slipNote)}</div>
      <div>ออกจากระบบจ่าย TellTea · อ้างอิง ${escapeReceiptHtml(receipt.key)}</div>
    </div>
  </div>
  ${autoPrintScript}
</body>
</html>`;
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
}): boolean {
  const html = buildPayrollPaymentDocHtml({ ...input, autoPrint: true });
  return openPayrollPaymentDocPrint(html);
}

export function downloadPayrollPaymentDoc(input: {
  receipt: StaffTransferReceipt;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
}): boolean {
  const html = buildPayrollPaymentDocHtml({ ...input, autoPrint: false });
  return downloadPayrollPaymentDocHtml(
    html,
    payrollPaymentDocFilename(input.receipt),
  );
}
