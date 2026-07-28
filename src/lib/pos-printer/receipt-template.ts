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
      display: inline-block;
      min-width: 0;
      min-height: 0;
      padding: 0;
      margin: 1px 0 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: #000;
      font-weight: 800;
      font-size: ${layout.bodyFontPx}px;
      line-height: 1.2;
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
  // Front-counter only — never print dine-in / takeaway / delivery channel badge.

  const shopName = shopDisplayName(data);
  const shopAddress = (data.shopAddress || DEFAULT_SHOP.shopAddress).trim();
  const shopPhone = (data.shopPhone || DEFAULT_SHOP.shopPhone).trim();
  const taxId = (data.taxId || "").trim();

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
  ].join("");

  const cashRows =
    data.paymentMethod === "cash"
      ? `<div class="total-row"><span>เงินสด</span><span>${formatMoney(data.cashReceived || 0)}</span></div>
         <div class="total-row"><span>เงินทอน</span><span>${formatMoney(data.change || 0)}</span></div>`
      : "";

  const notesBlock = data.orderNotes?.trim()
    ? `<div class="notes">${escapeReceiptHtml(data.orderNotes.trim())}</div>`
    : "";

  const customerParts = [
    data.customerName?.trim() || "",
    data.customerPhone?.trim() || "",
  ].filter(Boolean);
  const customerBlock = customerParts.length
    ? `<div class="customer">${escapeReceiptHtml(customerParts.join(" · "))}</div>`
    : "";

  const vatRow =
    data.vatBaht != null && data.vatBaht > 0
      ? `<div class="total-row"><span>VAT</span><span>${formatMoney(data.vatBaht)}</span></div>`
      : "";
  const serviceRow =
    data.serviceChargeBaht != null && data.serviceChargeBaht > 0
      ? `<div class="total-row"><span>ค่าบริการ</span><span>${formatMoney(data.serviceChargeBaht)}</span></div>`
      : "";

  const footerNote = (data.receiptFooterNote || "ขอบคุณที่อุดหนุน").trim();

  return `
  <div class="receipt">
    <div class="bill-no">${escapeReceiptHtml(billDisplay)}</div>
    ${customerBlock}
    <div class="shop-block">
      <div class="shop-name">${escapeReceiptHtml(shopName)}</div>
      ${shopAddress ? `<div class="shop-addr">${escapeReceiptHtml(shopAddress)}</div>` : ""}
      ${shopPhone ? `<div class="shop-phone">โทร : ${escapeReceiptHtml(shopPhone)}</div>` : ""}
      ${taxId ? `<div class="shop-phone">เลขผู้เสียภาษี : ${escapeReceiptHtml(taxId)}</div>` : ""}
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
      ${serviceRow}
      ${vatRow}
      <hr class="rule double" />
      <div class="total-row grand"><span>ยอดสุทธิ:</span><span>${formatMoney(data.total)}</span></div>
      <hr class="rule double" />
    </div>
    <div class="payment">
      <div class="total-row"><span>ชำระ</span><span>${escapeReceiptHtml(paymentLabel(data.paymentMethod))}</span></div>
      ${cashRows}
    </div>
    ${notesBlock}
    <div class="footer">${escapeReceiptHtml(footerNote)}</div>
  </div>`;
}

export type SampleReceiptCaseId =
  | "promptpay_options"
  | "cash_change"
  | "discount"
  | "multi_qty"
  | "pending"
  | "customer"
  | "vat_service";

export type SampleReceiptCase = {
  id: SampleReceiptCaseId;
  label: string;
  payload: ReceiptPrintPayload;
};

function demoBase(partial: Partial<ReceiptPrintPayload> & Pick<ReceiptPrintPayload, "billNo" | "lines" | "total" | "paymentMethod">): ReceiptPrintPayload {
  return {
    kind: "receipt",
    shopName: DEFAULT_SHOP.shopName,
    shopNameTh: DEFAULT_SHOP.shopNameTh,
    shopAddress: DEFAULT_SHOP.shopAddress,
    shopPhone: DEFAULT_SHOP.shopPhone,
    orderChannel: "dine_in",
    staffName: "หน้าร้าน",
    staffId: "DEMO",
    createdAt: Date.now(),
    receiptFooterNote: "ขอบคุณที่อุดหนุน",
    ...partial,
  };
}

/** ตัวอย่างสลิปสำหรับทดสอบเครื่องพิมพ์ */
export function sampleReceiptPayload(): ReceiptPrintPayload {
  return sampleReceiptCases()[0]!.payload;
}

/** ชุดตัวอย่างครบเงื่อนไข — ใช้ในตั้งค่าร้าน (ดูจัดวาง/ขาดตก) */
export function sampleReceiptCases(): SampleReceiptCase[] {
  return [
    {
      id: "promptpay_options",
      label: "PromptPay · ท็อปปิ้ง",
      payload: demoBase({
        billNo: "P2707-001",
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
        subtotal: 107,
        total: 107,
        paymentMethod: "promptpay",
      }),
    },
    {
      id: "cash_change",
      label: "เงินสด · ทอน",
      payload: demoBase({
        billNo: "P2707-002",
        lines: [
          {
            menuItemId: "demo3",
            name: "โกโก้เย็น",
            price: 35,
            qty: 1,
            options: [],
          },
        ],
        subtotal: 35,
        total: 35,
        paymentMethod: "cash",
        cashReceived: 100,
        change: 65,
      }),
    },
    {
      id: "discount",
      label: "ส่วนลดท้ายบิล",
      payload: demoBase({
        billNo: "P2707-003",
        lines: [
          {
            menuItemId: "demo4",
            name: "ชาไทยเย็น",
            price: 45,
            qty: 2,
            options: [
              {
                groupId: "sweet",
                groupName: "ความหวาน",
                choices: [{ optionId: "0", name: "ไม่หวาน", priceDelta: 0 }],
              },
            ],
          },
        ],
        subtotal: 90,
        discountBaht: 10,
        total: 80,
        paymentMethod: "cash",
        cashReceived: 80,
        change: 0,
        orderNotes: "ลดโปรสมาชิก",
      }),
    },
    {
      id: "multi_qty",
      label: "หลายรายการ · qty ใหญ่",
      payload: demoBase({
        billNo: "P2707-004",
        lines: [
          { menuItemId: "a", name: "น้ำเปล่า", price: 10, qty: 5, options: [] },
          { menuItemId: "b", name: "ครัวซองต์", price: 45, qty: 3, options: [] },
          {
            menuItemId: "c",
            name: "กาแฟเย็น",
            price: 55,
            qty: 1,
            options: [
              {
                groupId: "shot",
                groupName: "ช็อต",
                choices: [{ optionId: "x2", name: "2 ช็อต", priceDelta: 10 }],
              },
            ],
          },
        ],
        subtotal: 250,
        total: 250,
        paymentMethod: "promptpay",
      }),
    },
    {
      id: "pending",
      label: "บิลรอส่ง (ออฟไลน์)",
      payload: demoBase({
        billNo: "รอส่ง-A1B2C3",
        lines: [
          {
            menuItemId: "demo5",
            name: "ชานมไต้หวัน (ร้อน)",
            price: 29,
            qty: 1,
            options: [],
          },
        ],
        subtotal: 29,
        total: 29,
        paymentMethod: "cash",
        cashReceived: 29,
        change: 0,
      }),
    },
    {
      id: "customer",
      label: "ลูกค้า · เบอร์",
      payload: demoBase({
        billNo: "P2707-005",
        customerName: "คุณสมชาย",
        customerPhone: "0812345678",
        lines: [
          {
            menuItemId: "demo6",
            name: "ชานมไต้หวัน (เย็น)",
            price: 29,
            qty: 1,
            options: [],
          },
        ],
        subtotal: 29,
        total: 29,
        paymentMethod: "promptpay",
      }),
    },
    {
      id: "vat_service",
      label: "VAT · ค่าบริการ",
      payload: demoBase({
        billNo: "P2707-006",
        lines: [
          {
            menuItemId: "demo7",
            name: "ชุดของว่าง",
            price: 100,
            qty: 1,
            options: [],
          },
        ],
        subtotal: 100,
        serviceChargeBaht: 10,
        vatBaht: 7.7,
        total: 117.7,
        paymentMethod: "cash",
        cashReceived: 120,
        change: 2.3,
      }),
    },
  ];
}

/** รวมค่าจากตั้งค่าร้านลงตัวอย่างบิล */
export function applyShopToReceiptSample(
  sample: ReceiptPrintPayload,
  shop: {
    shopName?: string;
    shopNameTh?: string;
    shopAddress?: string;
    shopPhone?: string;
    taxId?: string;
    receiptStaffName?: string;
    receiptFooterNote?: string;
  },
): ReceiptPrintPayload {
  return {
    ...sample,
    shopName: shop.shopName?.trim() || sample.shopName,
    shopNameTh: shop.shopNameTh?.trim() || sample.shopNameTh,
    shopAddress: shop.shopAddress?.trim() || sample.shopAddress,
    shopPhone: shop.shopPhone?.trim() || sample.shopPhone,
    taxId: shop.taxId?.trim() || sample.taxId,
    staffName: shop.receiptStaffName?.trim() || sample.staffName,
    receiptFooterNote: shop.receiptFooterNote?.trim() || sample.receiptFooterNote,
  };
}
