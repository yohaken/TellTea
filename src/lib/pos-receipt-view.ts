import type { PosLocalReceipt, PosLocalReceiptLine } from "./pos-local-receipts";
import {
  formatReceiptModifierText,
  tallyLocalLineModifiers,
} from "./pos-receipt-format";
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
    | "shopName"
    | "shopNameTh"
    | "shopAddress"
    | "shopPhone"
    | "taxId"
    | "receiptStaffName"
    | "receiptFooterNote"
  >,
  staffId?: string,
): ReceiptPrintPayload {
  const lines = localReceiptLines(receipt).map(localReceiptLineToSaleLine);
  const subtotal = receiptSubtotal(localReceiptLines(receipt));
  const discountBaht = receiptDiscountBaht(receipt);
  const staffName =
    receipt.staffName?.trim() || shop.receiptStaffName?.trim() || undefined;
  return {
    kind: "receipt",
    shopName: shop.shopName,
    shopNameTh: shop.shopNameTh,
    shopAddress: shop.shopAddress,
    shopPhone: shop.shopPhone,
    taxId: shop.taxId?.trim() || undefined,
    billNo: receipt.billNo,
    lines,
    subtotal,
    discountBaht: discountBaht > 0 ? discountBaht : undefined,
    manualDiscountBaht:
      typeof receipt.manualDiscountBaht === "number" && receipt.manualDiscountBaht > 0
        ? receipt.manualDiscountBaht
        : undefined,
    redeemBaht:
      typeof receipt.redeemBaht === "number" && receipt.redeemBaht > 0
        ? receipt.redeemBaht
        : undefined,
    pointsRedeemed:
      typeof receipt.pointsRedeemed === "number" && receipt.pointsRedeemed > 0
        ? receipt.pointsRedeemed
        : undefined,
    pointsEarned:
      typeof receipt.pointsEarned === "number" && receipt.pointsEarned > 0
        ? receipt.pointsEarned
        : undefined,
    total: receipt.total,
    paymentMethod: receipt.paymentMethod,
    cashReceived: receipt.cashReceived,
    change: receipt.change,
    createdAt: receipt.createdAt,
    customerName: receipt.customerName?.trim() || undefined,
    customerPhone: receipt.customerPhone?.trim() || undefined,
    staffName,
    staffId: staffId || undefined,
    receiptFooterNote: shop.receiptFooterNote,
    vatBaht: receipt.vatBaht,
    serviceChargeBaht: receipt.serviceChargeBaht,
  };
}

export function receiptLineModifierLabels(line: PosLocalReceiptLine): string[] {
  return tallyLocalLineModifiers(line).map((m) =>
    formatReceiptModifierText(m.label, m.count),
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
