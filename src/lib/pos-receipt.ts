import type { PosSaleLine, PosSalePaymentMethod } from "./types";
import { formatPlainNumber } from "./utils";

export type PosReceiptData = {
  shopName: string;
  billNo: string;
  lines: PosSaleLine[];
  total: number;
  paymentMethod: PosSalePaymentMethod;
  cashReceived?: number;
  change?: number;
  createdAt: number;
};

function receiptHtml(data: PosReceiptData): string {
  const time = new Date(data.createdAt).toLocaleString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
  const payLabel = data.paymentMethod === "promptpay" ? "PromptPay" : "เงินสด";
  const lines = data.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.name)} ×${l.qty}</td><td style="text-align:right">฿${formatPlainNumber(l.price * l.qty)}</td></tr>`,
    )
    .join("");

  const cashRows =
    data.paymentMethod === "cash"
      ? `<tr><td>รับเงิน</td><td style="text-align:right">฿${formatPlainNumber(data.cashReceived || 0)}</td></tr>
         <tr><td>ทอน</td><td style="text-align:right">฿${formatPlainNumber(data.change || 0)}</td></tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(data.billNo)}</title>
  <style>
    body { font-family: system-ui, sans-serif; font-size: 14px; margin: 8px; color: #111; }
    h1 { font-size: 16px; margin: 0 0 4px; text-align: center; }
    .meta { text-align: center; color: #555; font-size: 12px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 3px 0; vertical-align: top; }
    .total td { font-weight: 700; border-top: 1px dashed #999; padding-top: 6px; }
    .thanks { text-align: center; margin-top: 14px; font-size: 12px; color: #555; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.shopName || "TellTea")}</h1>
  <p class="meta">${escapeHtml(data.billNo)} · ${time} · ${payLabel}</p>
  <table>${lines}</table>
  <table style="margin-top:8px">
    <tr class="total"><td>รวม</td><td style="text-align:right">฿${formatPlainNumber(data.total)}</td></tr>
    ${cashRows}
  </table>
  <p class="thanks">ขอบคุณที่อุดหนุน TellTea</p>
  <script>window.onload = function(){ window.print(); setTimeout(function(){ window.close(); }, 300); };</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Open browser print dialog with a narrow receipt layout (thermal-friendly). */
export function printPosReceipt(data: PosReceiptData): void {
  if (typeof window === "undefined") return;
  const win = window.open("", "_blank", "width=320,height=640");
  if (!win) return;
  win.document.write(receiptHtml(data));
  win.document.close();
}
