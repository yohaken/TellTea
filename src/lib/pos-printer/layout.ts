import { getLayoutForPrinter } from "./profiles";
import {
  buildUnifiedReceiptBody,
  escapeReceiptHtml,
  receiptLineBaseName,
  sampleReceiptPayload,
  unifiedReceiptStyles,
} from "./receipt-template";
import type { PosPrinterConfig, KitchenTicketPrintPayload, ReceiptPrintPayload } from "./types";

function printScript(): string {
  return `<script>window.onload = function(){ window.print(); setTimeout(function(){ window.close(); }, 300); };</script>`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatLineOptions(line: import("../types").PosSaleLine, compact: boolean): string[] {
  if (!line.options?.length) return [];
  const tallies = new Map<string, number>();
  for (const group of line.options) {
    for (const choice of group.choices) {
      const label = compact ? choice.name : `${group.groupName}: ${choice.name}`;
      tallies.set(label, (tallies.get(label) ?? 0) + 1);
    }
  }
  return [...tallies.entries()].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
}

/** สลิปใบเสร็จรูปแบบเดียว — รวมแบบ FoodStory / ShopeeFood / LINE MAN */
export function buildReceiptHtml(data: ReceiptPrintPayload, printer: PosPrinterConfig): string {
  const layout = getLayoutForPrinter(printer);
  const body = buildUnifiedReceiptBody(data, layout);
  const cutFooter =
    printer.cutMode === "manual" ? `<p class="cut-hint">— ฉีกตามเส้นนี้ —</p>` : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeReceiptHtml(data.billNo)}</title>
  <style>${unifiedReceiptStyles(layout, printer.cutMode)}</style>
</head>
<body>
  ${body}
  ${cutFooter}
  ${printScript()}
</body>
</html>`;
}

/** ใบสั่งครัว/บาร์ — ใช้โครงเดียวกับสลิปหลัก (เส้นแบ่ง · ตัวเลขใหญ่) แต่ไม่มีราคา */
export function buildKitchenTicketHtml(
  data: KitchenTicketPrintPayload,
  printer: PosPrinterConfig,
): string {
  const layout = getLayoutForPrinter(printer);
  const compact = layout.paperWidthMm === 58;
  const time = new Date(data.createdAt).toLocaleString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const station = data.stationLabel || (data.kind === "bar_ticket" ? "บาร์น้ำ" : "ครัว");
  const billDisplay = data.billNo.startsWith("#") ? data.billNo : `#${data.billNo}`;

  const lines = data.lines
    .map((l) => {
      const optRows = formatLineOptions(l, compact);
      const name = receiptLineBaseName(l);
      const modsBlock = optRows.length
        ? `<div class="mods">${optRows.map((part) => `<div>${escapeReceiptHtml(part)}</div>`).join("")}</div>`
        : "";
      return `<div class="item">
        <div class="item-line">
          <span class="qty">×${l.qty}</span>
          <span class="name">${escapeReceiptHtml(name)}</span>
          <span class="price"></span>
        </div>
        ${modsBlock}
      </div>`;
    })
    .join("");

  const cutFooter =
    printer.cutMode === "manual" ? `<p class="cut-hint">— ฉีกตามเส้นนี้ —</p>` : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeReceiptHtml(data.billNo)} ${escapeReceiptHtml(station)}</title>
  <style>${unifiedReceiptStyles(layout, printer.cutMode)}</style>
</head>
<body>
  <div class="receipt">
    <div class="channel">${escapeReceiptHtml(station)}</div>
    <div class="bill-no">${escapeReceiptHtml(billDisplay)}</div>
    <div class="meta-block">
      <div class="meta-row"><span class="meta-label">เวลา</span><span class="meta-colon">:</span><span class="meta-value">${escapeReceiptHtml(time)}</span></div>
    </div>
    <hr class="rule" />
    ${lines}
  </div>
  ${cutFooter}
  ${printScript()}
</body>
</html>`;
}

export function buildTestPageHtml(printer: PosPrinterConfig): string {
  return buildReceiptHtml(sampleReceiptPayload(), printer);
}
