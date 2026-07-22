/**
 * Plain-text receipt body — field order / labels match web HTML
 * `buildUnifiedReceiptBody` and native `ReceiptFormBuilder`.
 * Used for golden tests + docs; thermal on web still uses HTML → browser print.
 */
import type { PosSaleLine } from "../types";
import {
  receiptQtyEmphasized,
  tallySaleLineModifiers,
} from "../pos-receipt-format";
import { receiptLineBaseName } from "./receipt-template";
import type { ReceiptPrintPayload } from "./types";

const DEFAULT_SHOP = {
  shopName: "TELL TEA",
  shopNameTh: "เทล ที",
  shopAddress: "ถ.พรรณนาชัย ต.หมากแข้ง อ.เมืองอุดรธานี จ.อุดรธานี",
  shopPhone: "0884818817",
};

export const RECEIPT_TEXT_COLS_58 = 32;
export const RECEIPT_TEXT_COLS_80 = 42;

function shopDisplayName(data: ReceiptPrintPayload): string {
  const en = (data.shopName || DEFAULT_SHOP.shopName).trim();
  const th = (data.shopNameTh || DEFAULT_SHOP.shopNameTh).trim();
  if (th && !en.toLowerCase().includes(th.toLowerCase())) return `${en} (${th})`;
  return en;
}

function formatMoney(amount: number): string {
  if (Math.abs(amount - Math.round(amount)) < 0.0001) return String(Math.round(amount));
  return amount.toFixed(2);
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

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = Math.floor((width - text.length) / 2);
  return `${" ".repeat(pad)}${text}`;
}

function pairRow(left: string, right: string, width: number): string {
  let l = left;
  const r = right;
  if (l.length + 1 + r.length > width) {
    const maxLeft = Math.max(1, width - r.length - 1);
    if (l.length > maxLeft) l = `${l.slice(0, Math.max(1, maxLeft - 1))}…`;
  }
  const spaces = Math.max(1, width - l.length - r.length);
  return `${l}${" ".repeat(spaces)}${r}`;
}

function rule(width: number): string {
  return "-".repeat(width);
}

function doubleRule(width: number): string {
  return "=".repeat(width);
}

function wrap(text: string, width: number): string[] {
  if (!text) return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out;
}

function itemQtyTotal(lines: PosSaleLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

function appendItem(lines: string[], line: PosSaleLine, width: number, compact: boolean): void {
  const lineTotal = Math.round(line.price * line.qty * 100) / 100;
  const title = receiptLineBaseName(line);
  const priceText = formatMoney(lineTotal);
  if (receiptQtyEmphasized(line.qty)) {
    lines.push(pairRow(`×${line.qty} ${title}`, priceText, width));
  } else {
    lines.push(pairRow(title, priceText, width));
  }
  for (const mod of tallySaleLineModifiers(line, compact)) {
    let label = `• ${mod.label}`;
    if (mod.count > 1) label = `${label} ×${mod.count}`;
    for (const part of wrap(`  ${label}`, width)) lines.push(part);
  }
}

/** Build ESC/POS-style plain text matching native ReceiptFormBuilder. */
export function buildUnifiedReceiptText(
  data: ReceiptPrintPayload,
  cols: number = RECEIPT_TEXT_COLS_80,
): string {
  const width = cols <= 0 ? RECEIPT_TEXT_COLS_80 : cols;
  const compact = width <= RECEIPT_TEXT_COLS_58;
  const shopName = shopDisplayName(data);
  const shopAddress = (data.shopAddress || DEFAULT_SHOP.shopAddress).trim();
  const shopPhone = (data.shopPhone || DEFAULT_SHOP.shopPhone).trim();
  const billDisplay = data.billNo.startsWith("#") ? data.billNo : `#${data.billNo}`;
  const itemCount = itemQtyTotal(data.lines);
  const subtotal = data.subtotal ?? data.total;
  const footerNote = (data.receiptFooterNote || "ขอบคุณที่อุดหนุน").trim();

  const out: string[] = [];
  out.push(center(billDisplay, width));
  if (data.customerName?.trim()) out.push(center(data.customerName.trim(), width));
  out.push(center(shopName, width));
  if (shopAddress) for (const part of wrap(shopAddress, width)) out.push(center(part, width));
  if (shopPhone) out.push(center(`โทร : ${shopPhone}`, width));
  out.push(center("ใบเสร็จ", width));

  if (data.externalOrderId) out.push(`Order: ${data.externalOrderId}`);
  if (data.staffName) out.push(`Staff: ${data.staffName}`);
  if (data.staffId) out.push(`ID: ${data.staffId}`);
  out.push(`วันที่: ${formatReceiptDate(data.createdAt)}`);
  out.push(`เวลา: ${formatReceiptTime(data.createdAt)}`);
  out.push(rule(width));

  for (const line of data.lines) appendItem(out, line, width, compact);

  out.push(rule(width));
  out.push(pairRow("จำนวน:", String(itemCount), width));
  out.push(pairRow("รวม:", formatMoney(subtotal), width));
  if (data.discountBaht && data.discountBaht > 0) {
    out.push(pairRow("ส่วนลด", `-${formatMoney(data.discountBaht)}`, width));
  }
  out.push(doubleRule(width));
  out.push(pairRow("ยอดสุทธิ:", formatMoney(data.total), width));
  out.push(doubleRule(width));
  out.push(pairRow("ชำระ", paymentLabel(data.paymentMethod), width));
  if (data.paymentMethod === "cash") {
    out.push(pairRow("เงินสด", formatMoney(data.cashReceived || 0), width));
    out.push(pairRow("เงินทอน", formatMoney(data.change || 0), width));
  }
  if (data.orderNotes?.trim()) {
    out.push(rule(width));
    for (const part of wrap(data.orderNotes.trim(), width)) out.push(part);
  }
  out.push("");
  out.push(center(footerNote, width));
  out.push(center("TellTea POS", width));
  return `${out.join("\n")}\n`;
}
