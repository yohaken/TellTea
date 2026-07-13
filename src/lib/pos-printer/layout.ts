import { formatPlainNumber } from "../utils";
import type { PosSaleLine } from "../types";
import type { PrinterKindProfile } from "./profiles";
import { getLayoutForPrinter } from "./profiles";
import type {
  KitchenTicketPrintPayload,
  PosPrinterConfig,
  ReceiptPrintPayload,
} from "./types";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatLineOptions(line: PosSaleLine, compact: boolean): string {
  if (!line.options?.length) return "";
  const parts = line.options.flatMap((g) =>
    g.choices.map((c) => (compact ? c.name : `${g.groupName}: ${c.name}`)),
  );
  return parts.join(compact ? ", " : " · ");
}

function receiptStyles(layout: PrinterKindProfile, cutMode: "auto" | "manual"): string {
  const cutHint =
    cutMode === "auto"
      ? ".cut-hint { display: none; }"
      : ".cut-hint { text-align: center; margin-top: 12px; font-size: 10px; color: #888; border-top: 1px dashed #ccc; padding-top: 8px; }";
  return `
    @page { margin: 0; size: ${layout.paperWidthMm}mm auto; }
    body {
      font-family: "Sarabun", system-ui, sans-serif;
      font-size: ${layout.bodyFontPx}px;
      margin: ${layout.paperWidthMm === 58 ? "4px" : "6px"};
      color: #111;
      max-width: ${layout.paperWidthMm}mm;
      line-height: 1.35;
    }
    h1 { font-size: ${layout.titleFontPx}px; margin: 0 0 4px; text-align: center; font-weight: 700; }
    .meta { text-align: center; color: #555; font-size: ${layout.metaFontPx}px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2px 0; vertical-align: top; word-break: break-word; }
    .item-name { max-width: ${Math.floor(layout.charsPerLine * 0.65)}ch; }
    .item-opt { font-size: ${layout.metaFontPx}px; color: #444; padding-left: 4px; }
    .total td { font-weight: 700; border-top: 1px dashed #999; padding-top: 6px; }
    .thanks { text-align: center; margin-top: 12px; font-size: ${layout.metaFontPx}px; color: #555; }
    ${cutHint}
    @media print { body { margin: 0; } }
  `;
}

export function buildReceiptHtml(data: ReceiptPrintPayload, printer: PosPrinterConfig): string {
  const layout = getLayoutForPrinter(printer);
  const compact = layout.paperWidthMm === 58;
  const time = new Date(data.createdAt).toLocaleString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
  const payLabel = data.paymentMethod === "promptpay" ? "PromptPay" : "เงินสด";

  const lines = data.lines
    .map((l) => {
      const opt = formatLineOptions(l, compact);
      const name = truncate(l.name, layout.charsPerLine - 8);
      const optRow = opt
        ? `<tr><td colspan="2" class="item-opt">${escapeHtml(truncate(opt, layout.charsPerLine))}</td></tr>`
        : "";
      return `<tr>
        <td class="item-name">${escapeHtml(name)} ×${l.qty}</td>
        <td style="text-align:right;white-space:nowrap">฿${formatPlainNumber(l.price * l.qty)}</td>
      </tr>${optRow}`;
    })
    .join("");

  const cashRows =
    data.paymentMethod === "cash"
      ? `<tr><td>รับเงิน</td><td style="text-align:right">฿${formatPlainNumber(data.cashReceived || 0)}</td></tr>
         <tr><td>ทอน</td><td style="text-align:right">฿${formatPlainNumber(data.change || 0)}</td></tr>`
      : "";

  const cutFooter =
    printer.cutMode === "manual"
      ? `<p class="cut-hint">— ฉีกตามเส้นนี้ —</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(data.billNo)}</title>
  <style>${receiptStyles(layout, printer.cutMode)}</style>
</head>
<body>
  <h1>${escapeHtml(data.shopName || "TellTea")}</h1>
  <p class="meta">${escapeHtml(data.billNo)} · ${time} · ${payLabel}</p>
  <table>${lines}</table>
  <table style="margin-top:8px">
    <tr class="total"><td>รวม</td><td style="text-align:right">฿${formatPlainNumber(data.total)}</td></tr>
    ${cashRows}
  </table>
  <p class="thanks">ขอบคุณที่อุดหนุน</p>
  ${cutFooter}
  <script>window.onload = function(){ window.print(); setTimeout(function(){ window.close(); }, 300); };</script>
</body>
</html>`;
}

export function buildKitchenTicketHtml(
  data: KitchenTicketPrintPayload,
  printer: PosPrinterConfig,
): string {
  const layout = getLayoutForPrinter(printer);
  const compact = layout.paperWidthMm === 58;
  const time = new Date(data.createdAt).toLocaleString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const station = data.stationLabel || (data.kind === "bar_ticket" ? "บาร์น้ำ" : "ครัว");

  const lines = data.lines
    .map((l) => {
      const opt = formatLineOptions(l, compact);
      const name = truncate(l.name, layout.charsPerLine - 4);
      const optRow = opt
        ? `<div class="item-opt">${escapeHtml(truncate(opt, layout.charsPerLine))}</div>`
        : "";
      return `<div class="item">
        <div class="item-row"><span class="qty">×${l.qty}</span> <span class="name">${escapeHtml(name)}</span></div>
        ${optRow}
      </div>`;
    })
    .join("");

  const cutFooter =
    printer.cutMode === "manual"
      ? `<p class="cut-hint">— ฉีกตามเส้นนี้ —</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(data.billNo)} ${station}</title>
  <style>
    @page { margin: 0; size: ${layout.paperWidthMm}mm auto; }
    body {
      font-family: "Sarabun", system-ui, sans-serif;
      font-size: ${layout.bodyFontPx}px;
      margin: ${layout.paperWidthMm === 58 ? "4px" : "6px"};
      max-width: ${layout.paperWidthMm}mm;
    }
    h1 { font-size: ${layout.titleFontPx}px; margin: 0; text-align: center; font-weight: 800; }
    .meta { text-align: center; font-size: ${layout.metaFontPx}px; color: #333; margin: 6px 0 10px; }
    .item { border-bottom: 1px dashed #bbb; padding: 6px 0; }
    .item-row { display: flex; gap: 6px; align-items: baseline; }
    .qty { font-weight: 800; font-size: ${layout.titleFontPx}px; min-width: 2ch; }
    .name { font-weight: 600; flex: 1; word-break: break-word; }
    .item-opt { font-size: ${layout.metaFontPx}px; color: #444; margin-top: 2px; padding-left: 1.5em; }
    .cut-hint { text-align: center; margin-top: 12px; font-size: 10px; color: #888; border-top: 1px dashed #ccc; padding-top: 8px; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(station)}</h1>
  <p class="meta">${escapeHtml(data.billNo)} · ${time}</p>
  ${lines}
  ${cutFooter}
  <script>window.onload = function(){ window.print(); setTimeout(function(){ window.close(); }, 300); };</script>
</body>
</html>`;
}

export function buildTestPageHtml(printer: PosPrinterConfig): string {
  const layout = getLayoutForPrinter(printer);
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>ทดสอบ ${escapeHtml(printer.name)}</title>
  <style>
    body { font-family: system-ui, sans-serif; font-size: ${layout.bodyFontPx}px; margin: 8px; max-width: ${layout.paperWidthMm}mm; }
    h1 { font-size: ${layout.titleFontPx}px; text-align: center; }
    p { text-align: center; color: #555; }
    .spec { font-size: ${layout.metaFontPx}px; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>ทดสอบเครื่องพิมพ์</h1>
  <p>${escapeHtml(printer.name)}</p>
  <p class="spec">${layout.paperWidthMm}mm · ${printer.cutMode === "auto" ? "ตัดอัตโนมัติ" : "ฉีกมือ"} · ${layout.charsPerLine} ตัวอักษร/บรรทัด</p>
  <script>window.onload = function(){ window.print(); setTimeout(function(){ window.close(); }, 300); };</script>
</body>
</html>`;
}
