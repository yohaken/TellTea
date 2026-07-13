import type { ReceiptPrintPayload } from "./pos-printer/types";
import { printCustomerReceipt } from "./pos-printer";

export type PosReceiptData = ReceiptPrintPayload;

/** @deprecated ใช้ printCustomerReceipt จาก pos-printer แทน */
export function printPosReceipt(data: PosReceiptData): void {
  void printCustomerReceipt(data);
}
