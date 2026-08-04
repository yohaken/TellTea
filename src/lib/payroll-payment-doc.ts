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
import { formatDateTimeShortBe, formatPlainNumber } from "./utils";

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

export function buildPayrollPaymentDocHtml(input: {
  receipt: StaffTransferReceipt;
  shop: PayrollPaymentDocShop;
  payee: PayrollPaymentDocPayee;
  /** ใส่สคริปต์สั่งพิมพ์อัตโนมัติเมื่อเปิดหน้าต่างพิมพ์ */
  autoPrint?: boolean;
}): string {
  const { receipt, shop, payee } = input;
  const title = `ใบสรุปการจ่าย · ${payee.employeeName} · ${receipt.periodMonth}`;
  const paidLabel = receipt.paidAt
    ? formatDateTimeShortBe(receipt.paidAt)
    : "—";
  const bankLine = [
    payee.payBank,
    payee.payAccountNo,
    payee.payAccountName ? `(${payee.payAccountName})` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const lineRows = receipt.lines
    .map((line) => {
      const meta: string[] = [];
      if (line.grossAmount > 0 && line.grossAmount !== line.amount) {
        meta.push(`ก่อนหัก ฿${money(line.grossAmount)}`);
      }
      if (line.advanceDeduct > 0) {
        meta.push(`หักเบิก ฿${money(line.advanceDeduct)}`);
      }
      if (line.kind === "bonus" && line.bonusRemaining > 0) {
        meta.push(`โบนัสคงเหลือ ฿${money(line.bonusRemaining)}`);
      }
      if (line.note) meta.push(line.note);
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
    ? `มีสลิปโอนแนบในระบบ ${receipt.slipUrls.length} รูป — ดูได้ที่แท็บประวัติ`
    : "ยังไม่มีสลิปโอนแนบในระบบ";

  const autoPrintScript = input.autoPrint
    ? `<script>
      window.addEventListener("load", function () {
        setTimeout(function () { window.focus(); window.print(); }, 250);
      });
    </script>`
    : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeReceiptHtml(title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif;
      color: #1a1a1a;
      background: #fff;
      font-size: 14px;
      line-height: 1.45;
    }
    .sheet {
      max-width: 720px;
      margin: 0 auto;
      padding: 20px 22px 28px;
    }
    .brand {
      font-size: 1.55rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      margin: 0 0 0.15rem;
    }
    .brand-th { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.35rem; }
    .doc-title {
      margin: 1rem 0 0.35rem;
      font-size: 1.15rem;
      font-weight: 700;
      border-top: 2px solid #222;
      padding-top: 0.75rem;
    }
    .muted { color: #555; }
    .tiny { font-size: 0.85rem; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin: 0.2rem 0;
    }
    .sec { font-weight: 700; margin: 0.9rem 0 0.35rem; }
    table.pay {
      width: 100%;
      border-collapse: collapse;
      margin: 0.4rem 0 0.6rem;
    }
    table.pay th, table.pay td {
      border-bottom: 1px solid #ddd;
      padding: 0.45rem 0.2rem;
      text-align: left;
      vertical-align: top;
    }
    table.pay th { font-size: 0.85rem; color: #444; font-weight: 600; }
    table.pay td.num, table.pay th.num { text-align: right; white-space: nowrap; }
    .line-kind { font-weight: 600; }
    .total {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-top: 0.75rem;
      padding-top: 0.55rem;
      border-top: 2px solid #222;
      font-size: 1.15rem;
      font-weight: 700;
    }
    .foot {
      margin-top: 1.25rem;
      padding-top: 0.65rem;
      border-top: 1px dashed #bbb;
      font-size: 0.85rem;
      color: #555;
    }
    .badge {
      display: inline-block;
      margin-left: 0.35rem;
      padding: 0.1rem 0.4rem;
      border: 1px solid #888;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    @media print {
      body { margin: 0; }
      .sheet { padding: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <h1 class="brand">${escapeReceiptHtml(shop.shopName)}</h1>
    ${
      shop.shopNameTh
        ? `<p class="brand-th">${escapeReceiptHtml(shop.shopNameTh)}</p>`
        : ""
    }
    ${
      shop.shopAddress
        ? `<div class="muted tiny">${escapeReceiptHtml(shop.shopAddress)}</div>`
        : ""
    }
    ${
      shop.shopPhone
        ? `<div class="muted tiny">โทร ${escapeReceiptHtml(shop.shopPhone)}</div>`
        : ""
    }
    ${
      shop.taxId
        ? `<div class="muted tiny">เลขผู้เสียภาษี ${escapeReceiptHtml(shop.taxId)}</div>`
        : ""
    }

    <h2 class="doc-title">
      ใบสรุปหลักฐานการจ่าย
      ${receipt.combined ? `<span class="badge">โอนรวม</span>` : ""}
    </h2>
    <div class="muted tiny">เอกสารภายในร้าน · เงินเดือน / โบนัส · ไม่ใช่ใบหักภาษี ณ ที่จ่าย</div>

    <div class="sec">ผู้รับเงิน</div>
    <div class="row"><span>ชื่อพนักงาน</span><span><strong>${escapeReceiptHtml(payee.employeeName)}</strong></span></div>
    ${
      bankLine
        ? `<div class="row"><span>บัญชีรับโอน</span><span>${escapeReceiptHtml(bankLine)}</span></div>`
        : ""
    }

    <div class="sec">รอบจ่าย</div>
    <div class="row"><span>งวด</span><span>${escapeReceiptHtml(receipt.periodMonth)}</span></div>
    <div class="row"><span>วัน–เวลาโอน</span><span>${escapeReceiptHtml(paidLabel)}</span></div>
    ${
      receipt.note
        ? `<div class="row"><span>หมายเหตุ</span><span>${escapeReceiptHtml(receipt.note)}</span></div>`
        : ""
    }

    <div class="sec">รายการ</div>
    <table class="pay">
      <thead>
        <tr><th>รายการ</th><th class="num">ยอดโอน</th></tr>
      </thead>
      <tbody>
        ${lineRows}
      </tbody>
    </table>
    ${
      receipt.advanceDeductTotal > 0
        ? `<div class="row muted"><span>หักเบิกรวมในรอบนี้</span><span>฿${money(receipt.advanceDeductTotal)}</span></div>`
        : ""
    }
    <div class="total">
      <span>รวมยอดโอน</span>
      <span>฿${money(receipt.transferTotal)}</span>
    </div>

    <div class="foot">
      <div>${escapeReceiptHtml(slipNote)}</div>
      <div style="margin-top:0.35rem">ออกจากระบบจ่าย TellTea · อ้างอิงรอบ ${escapeReceiptHtml(receipt.key)}</div>
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
