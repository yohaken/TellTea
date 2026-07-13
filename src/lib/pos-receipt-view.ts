import type { PosLocalReceipt, PosLocalReceiptLine } from "./pos-local-receipts";
import type { PosSaleLine } from "./types";
import type { ReceiptPrintPayload } from "./pos-printer/types";

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
  shop: { shopName: string; shopNameTh: string; shopAddress: string; shopPhone: string },
): ReceiptPrintPayload {
  const lines = localReceiptLines(receipt).map(localReceiptLineToSaleLine);
  return {
    kind: "receipt",
    shopName: shop.shopName,
    shopNameTh: shop.shopNameTh,
    shopAddress: shop.shopAddress,
    shopPhone: shop.shopPhone,
    billNo: receipt.billNo,
    lines,
    total: receipt.total,
    paymentMethod: receipt.paymentMethod,
    cashReceived: receipt.cashReceived,
    change: receipt.change,
    createdAt: receipt.createdAt,
    orderChannel: "dine_in",
    staffName: "TellTea POS",
  };
}

export function receiptSubtotal(lines: PosLocalReceiptLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) * 100) / 100;
}
