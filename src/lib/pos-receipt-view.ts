import type { PosLocalReceipt, PosLocalReceiptLine } from "./pos-local-receipts";
import { tallyLocalLineModifiers } from "./pos-receipt-format";
import type { PosSaleLine } from "./types";
import type { ReceiptPrintPayload } from "./pos-printer/types";
import type { PosShopSettings } from "./pos-settings";

export function localReceiptLines(receipt: PosLocalReceipt): PosLocalReceiptLine[] {
  if (receipt.lines?.length) return receipt.lines;
  return receipt.linePreview.split(",").map((part) => ({
    name: part.trim(),
    qty: 1,
    unitPrice: receipt.total,
    options: [],
  }));
}

export function localReceiptLineToSaleLine(line: PosLocalReceiptLine): PosSaleLine {
  const modText = line.options.flatMap((o) => o.choiceNames).join(", ");
  const name = modText ? `${line.name} (${modText})` : line.name;
  return {
    menuItemId: `local_${line.name}`,
    name,
    qty: line.qty,
    price: line.unitPrice,
    options: line.options.map((o) => ({
      groupId: o.groupName,
      groupName: o.groupName,
      choices: o.choiceNames.map((n) => ({
        optionId: n,
        name: n,
        priceDelta: 0,
      })),
    })),
  };
}

export function localReceiptToPrintPayload(
  receipt: PosLocalReceipt,
  shop: Pick<
    PosShopSettings,
    "shopName" | "shopNameTh" | "shopAddress" | "shopPhone" | "receiptStaffName" | "receiptFooterNote"
  >,
  staffId?: string,
): ReceiptPrintPayload {
  const lines = localReceiptLines(receipt).map(localReceiptLineToSaleLine);
  const subtotal = receiptSubtotal(localReceiptLines(receipt));
  const discountBaht = receiptDiscountBaht(receipt);
  return {
    kind: "receipt",
    shopName: shop.shopName,
    shopNameTh: shop.shopNameTh,
    shopAddress: shop.shopAddress,
    shopPhone: shop.shopPhone,
    billNo: receipt.billNo,
    lines,
    subtotal,
    discountBaht: discountBaht > 0 ? discountBaht : undefined,
    total: receipt.total,
    paymentMethod: receipt.paymentMethod,
    cashReceived: receipt.cashReceived,
    change: receipt.change,
    createdAt: receipt.createdAt,
    staffName: shop.receiptStaffName,
    staffId: staffId || undefined,
    receiptFooterNote: shop.receiptFooterNote,
  };
}

export function receiptLineModifierLabels(line: PosLocalReceiptLine): string[] {
  return tallyLocalLineModifiers(line).map((m) =>
    m.count > 1 ? `${m.label} ×${m.count}` : m.label,
  );
}

export function receiptSubtotal(lines: PosLocalReceiptLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) * 100) / 100;
}

/** ส่วนลดท้ายบิล — จากฟิลด์ หรืออนุมานจากยอดรายการ − ยอดสุทธิ (บิลเก่า) */
export function receiptDiscountBaht(receipt: PosLocalReceipt): number {
  const stored = Math.max(0, Math.round(Number(receipt.discountBaht || 0) * 100) / 100);
  if (stored > 0) return stored;
  const lines = localReceiptLines(receipt);
  if (!lines.length) return 0;
  const sub = receiptSubtotal(lines);
  const diff = Math.round((sub - receipt.total) * 100) / 100;
  return diff > 0.004 ? diff : 0;
}
