import { formatPlainNumber } from "../utils";
import type { PosSaleLine } from "../types";
import {
  receiptQtyEmphasized,
  tallySaleLineModifiers,
  type ReceiptModifierTally,
} from "../pos-receipt-format";
import type { PrinterKindProfile } from "./profiles";
import type { PosPrinterConfig, ReceiptOrderChannel, ReceiptPrintPayload } from "./types";

export const RECEIPT_CHANNEL_LABELS: Record<ReceiptOrderChannel, string> = {
  dine_in: "ทานที่ร้าน",
  takeaway: "สั่งกลับบ้าน",
  shopeefood: "ShopeeFood",
  lineman: "LINE MAN",
  grab: "GrabFood",
  other: "ช่องทางอื่น",
};

const DEFAULT_SHOP = {
  shopName: "TELL TEA",
  shopNameTh: "เทล ที",
  shopAddress: "ถ.พรรณนาชัย ต.หมากแข้ง อ.เมืองอุดรธานี จ.อุดรธานี",
  shopPhone: "0884818817",
};

export function escapeReceiptHtml(text: string): string {
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

/** ชื่อเมนูหลัก — ตัดส่วนตัวเลือกที่ต่อท้ายในวงเล็บออก (แสดงใน mods แยก) */
export function receiptLineBaseName(line: PosSaleLine): string {
  const paren = line.name.indexOf(" (");
  if (paren > 0) return line.name.slice(0, paren).trim();
  return line.name.trim();
}

function formatMoney(amount: number): string {
  return formatPlainNumber(amount);
}

function formatReceiptDate(ts: number): string {
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatReceiptTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function paymentLabel(method: ReceiptPrintPayload["paymentMethod"]): string {
  return method === "promptpay" ? "PromptPay" : "เงินสด";
}

function shopDisplayName(data: ReceiptPrintPayload): string {
  const en = (data.shopName || DEFAULT_SHOP.shopName).trim();
  const th = (data.shopNameTh || DEFAULT_SHOP.shopNameTh).trim();
  if (th && !en.toLowerCase().includes(th)) return `${en} (${th})`;
  return en;
}

function lineModifiers(line: PosSaleLine, compact: boolean): ReceiptModifierTally[] {
  return tallySaleLineModifiers(line, compact);
}

function renderModifierHtml(mod: ReceiptModifierTally): string {
  const label = escapeReceiptHtml(mod.label);
  if (mod.count > 1) {
    return `<div class="mod-line"><span class="mod-bullet">•</span> <span class="mod-label">${label}</span> <strong class="mod-qty">×${mod.count}</strong></div>`;
  }
  return `<div class="mod-line"><span class="mod-bullet">•</span> <span class="mod-label">${label}</span></div>`;
}

function renderItemQtyHtml(qty: number): string {
  if (!receiptQtyEmphasized(qty)) return "";
  return `<span class="qty-badge">×${qty}</span>`;
}

function itemQtyTotal(lines: PosSaleLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

function metaRow(label: string, value: string): string {
  if (!value) return "";
  return `<div class="meta-row"><span class="meta-label">${escapeReceiptHtml(label)}</span><span class="meta-colon">:</span><span class="meta-value">${escapeReceiptHtml(value)}</span></div>`;
}

export function unifiedReceiptStyles(layout: PrinterKindProfile, cutMode: PosPrinterConfig["cutMode"]): string {
  const cutHint =
    cutMode === "auto"
      ? ".cut-hint { display: none; }"
      : `.cut-hint { text-align: center; margin-top: 10px; font-size: ${layout.metaFontPx}px; color: #888; border-top: 1px dashed #aaa; padding-top: 8px; }`;

  return `
    @page { margin: 0; size: ${layout.paperWidthMm}mm auto; }
    * { box-sizing: border-box; }
    body {
      font-family: "Sarabun", "Noto Sans Thai", system-ui, sans-serif;
      font-size: ${layout.bodyFontPx}px;
      margin: ${layout.paperWidthMm === 58 ? "3px 4px" : "4px 6px"};
      color: #111;
      max-width: ${layout.paperWidthMm}mm;
      line-height: 1.3;
    }
    .receipt { width: 100%; }
    .channel {
      text-align: center;
      font-weight: 700;
      font-size: ${layout.titleFontPx}px;
      margin-bottom: 4px;
      letter-spacing: 0.02em;
    }
    .bill-no {
      text-align: center;
      font-weight: 800;
      font-size: ${layout.titleFontPx + 4}px;
      margin: 2px 0 8px;
      letter-spacing: 0.04em;
    }
    .customer {
      text-align: center;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .shop-block { text-align: center; margin-bottom: 8px; }
    .shop-name {
      font-weight: 700;
      font-size: ${layout.titleFontPx}px;
      margin-bottom: 2px;
    }
    .shop-addr, .shop-phone {
      font-size: ${layout.metaFontPx}px;
      color: #333;
      word-break: break-word;
    }
    .doc-title {
      text-align: center;
      font-weight: 700;
      font-size: ${layout.bodyFontPx + 1}px;
      margin: 8px 0;
    }
    .meta-block { font-size: ${layout.metaFontPx}px; margin-bottom: 6px; }
    .meta-row {
      display: grid;
      grid-template-columns: auto 0.5em 1fr;
      gap: 0 4px;
      margin: 1px 0;
    }
    .meta-label { white-space: nowrap; }
    .meta-value { word-break: break-word; }
    .rule {
      border: 0;
      border-top: 1px dashed #888;
      margin: 8px 0;
    }
    .rule.double {
      border-top: 3px double #111;
      margin: 6px 0;
    }
    .item {
      margin: 10px 0;
      padding-bottom: 8px;
      border-bottom: 1px dashed #aaa;
    }
    .item:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .item-line {
      display: grid;
      grid-template-columns: ${layout.paperWidthMm === 58 ? "1.85em" : "2em"} minmax(0, 1fr) auto;
      gap: 6px 8px;
      align-items: start;
    }
    .item-line--single {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .qty-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.65em;
      min-height: 1.65em;
      padding: 0.08em 0.28em;
      border-radius: 0.32em;
      background: #1a1f24;
      color: #fff;
      font-weight: 800;
      font-size: ${layout.bodyFontPx + 1}px;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .qty-plain {
      display: none;
    }
    .name {
      font-weight: 800;
      font-size: ${layout.bodyFontPx + 1}px;
      color: #000;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: normal;
      padding-right: 4px;
      line-height: 1.35;
    }
    .price {
      white-space: nowrap;
      text-align: right;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .mods {
      margin: 4px 0 0 0.35em;
      font-size: ${layout.metaFontPx}px;
      color: #555;
      font-weight: 500;
    }
    .mod-line {
      margin: 2px 0;
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .mod-bullet { color: #888; }
    .mod-qty {
      font-weight: 800;
      color: #000;
      font-variant-numeric: tabular-nums;
    }
    .totals { font-size: ${layout.bodyFontPx}px; }
    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 2px 0;
      font-variant-numeric: tabular-nums;
    }
    .total-row.grand {
      font-weight: 800;
      font-size: ${layout.bodyFontPx + 1}px;
    }
    .payment { margin-top: 8px; font-size: ${layout.bodyFontPx}px; }
    .notes {
      margin-top: 8px;
      font-size: ${layout.metaFontPx}px;
      color: #333;
      border: 1px dashed #bbb;
      padding: 4px 6px;
    }
    .footer {
      text-align: center;
      margin-top: 12px;
      font-size: ${layout.metaFontPx}px;
      color: #555;
    }
    ${cutHint}
    @media print { body { margin: 0; } }
  `;
}

export function buildUnifiedReceiptBody(data: ReceiptPrintPayload, layout: PrinterKindProfile): string {
  const compact = layout.paperWidthMm === 58;
  const channel = data.orderChannel || "dine_in";
  const channelLabel = RECEIPT_CHANNEL_LABELS[channel];
  const showChannelBadge = channel !== "dine_in";

  const shopName = shopDisplayName(data);
  const shopAddress = (data.shopAddress || DEFAULT_SHOP.shopAddress).trim();
  const shopPhone = (data.shopPhone || DEFAULT_SHOP.shopPhone).trim();

  const billDisplay = data.billNo.startsWith("#") ? data.billNo : `#${data.billNo}`;
  const itemCount = itemQtyTotal(data.lines);

  const itemsHtml = data.lines
    .map((line) => {
      const mods = lineModifiers(line, compact)
        .map((m) => renderModifierHtml(m))
        .join("");
      const modsBlock = mods ? `<div class="mods">${mods}</div>` : "";
      const lineTotal = Math.round(line.price * line.qty * 100) / 100;
      const title = receiptLineBaseName(line);
      const qtyBadge = renderItemQtyHtml(line.qty);
      const lineClass = receiptQtyEmphasized(line.qty) ? "item-line" : "item-line item-line--single";
      return `<div class="item">
        <div class="${lineClass}">
          ${qtyBadge}
          <span class="name">${escapeReceiptHtml(title)}</span>
          <span class="price">${formatMoney(lineTotal)}</span>
        </div>
        ${modsBlock}
      </div>`;
    })
    .join("");

  const metaRows = [
    data.externalOrderId ? metaRow("Order", data.externalOrderId) : "",
    data.staffName ? metaRow("Staff", data.staffName) : "",
    data.staffId ? metaRow("ID", data.staffId) : "",
    metaRow("วันที่", formatReceiptDate(data.createdAt)),
    metaRow("เวลา", formatReceiptTime(data.createdAt)),
    metaRow("ประเภท", channelLabel),
  ].join("");

  const cashRows =
    data.paymentMethod === "cash"
      ? `<div class="total-row"><span>เงินสด</span><span>${formatMoney(data.cashReceived || 0)}</span></div>
         <div class="total-row"><span>เงินทอน</span><span>${formatMoney(data.change || 0)}</span></div>`
      : "";

  const notesBlock = data.orderNotes?.trim()
    ? `<div class="notes">${escapeReceiptHtml(data.orderNotes.trim())}</div>`
    : "";

  const customerBlock = data.customerName?.trim()
    ? `<div class="customer">${escapeReceiptHtml(data.customerName.trim())}</div>`
    : "";

  const channelBlock = showChannelBadge
    ? `<div class="channel">${escapeReceiptHtml(channelLabel)}</div>`
    : "";

  const footerNote = (data.receiptFooterNote || "ขอบคุณที่อุดหนุน").trim();

  return `
  <div class="receipt">
    ${channelBlock}
    <div class="bill-no">${escapeReceiptHtml(billDisplay)}</div>
    ${customerBlock}
    <div class="shop-block">
      <div class="shop-name">${escapeReceiptHtml(shopName)}</div>
      ${shopAddress ? `<div class="shop-addr">${escapeReceiptHtml(shopAddress)}</div>` : ""}
      ${shopPhone ? `<div class="shop-phone">โทร : ${escapeReceiptHtml(shopPhone)}</div>` : ""}
    </div>
    <div class="doc-title">ใบเสร็จ</div>
    <div class="meta-block">${metaRows}</div>
    <hr class="rule" />
    ${itemsHtml}
    <hr class="rule" />
    <div class="totals">
      <div class="total-row"><span>จำนวน:</span><span>${itemCount}</span></div>
      <div class="total-row"><span>รวม:</span><span>${formatMoney(data.subtotal ?? data.total)}</span></div>
      ${
        data.discountBaht && data.discountBaht > 0
          ? `<div class="total-row"><span>ส่วนลด</span><span>-${formatMoney(data.discountBaht)}</span></div>`
          : ""
      }
      <hr class="rule double" />
      <div class="total-row grand"><span>ยอดสุทธิ:</span><span>${formatMoney(data.total)}</span></div>
      <hr class="rule double" />
    </div>
    <div class="payment">
      <div class="total-row"><span>ชำระ</span><span>${escapeReceiptHtml(paymentLabel(data.paymentMethod))}</span></div>
      ${cashRows}
    </div>
    ${notesBlock}
    <div class="footer">${escapeReceiptHtml(footerNote)}<br />TellTea POS</div>
  </div>`;
}

/** ตัวอย่างสลิปสำหรับทดสอบเครื่องพิมพ์ */
export function sampleReceiptPayload(): ReceiptPrintPayload {
  return {
    kind: "receipt",
    shopName: DEFAULT_SHOP.shopName,
    shopNameTh: DEFAULT_SHOP.shopNameTh,
    shopAddress: DEFAULT_SHOP.shopAddress,
    shopPhone: DEFAULT_SHOP.shopPhone,
    billNo: "561",
    orderChannel: "dine_in",
    staffName: "TellTea POS",
    staffId: "DEMO",
    lines: [
      {
        menuItemId: "demo1",
        name: "ชานมไต้หวัน (เย็น)",
        price: 29,
        qty: 1,
        options: [
          {
            groupId: "sweet",
            groupName: "ความหวาน",
            choices: [{ optionId: "50", name: "หวาน 50%", priceDelta: 0 }],
          },
          {
            groupId: "top",
            groupName: "ท็อปปิ้ง",
            choices: [{ optionId: "pearl", name: "ไข่มุก", priceDelta: 0 }],
          },
        ],
      },
      {
        menuItemId: "demo2",
        name: "ชาเขียวนม (ปั่น)",
        price: 39,
        qty: 2,
        options: [
          {
            groupId: "sweet",
            groupName: "ความหวาน",
            choices: [{ optionId: "100", name: "หวาน 100%", priceDelta: 0 }],
          },
        ],
      },
    ],
    total: 107,
    paymentMethod: "promptpay",
    createdAt: Date.now(),
  };
}
