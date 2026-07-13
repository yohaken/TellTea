export type {
  CutMode,
  KitchenTicketPrintPayload,
  PaperWidthMm,
  PosPrinterConfig,
  PosPrinterSetup,
  PrintBatchResult,
  PrintJob,
  PrintJobKind,
  PrintPayload,
  PrintResult,
  PrinterConnection,
  PrinterKind,
  PrinterRole,
  ReceiptPrintPayload,
  ReceiptOrderChannel,
} from "./types";

export {
  PRINTER_CONNECTION_LABELS,
  PRINTER_KIND_PROFILES,
  PRINTER_ROLE_LABELS,
  createPrinterFromKind,
  defaultPrinterSetup,
  getKindProfile,
  getLayoutForPrinter,
  newPrinterId,
} from "./profiles";

export { buildKitchenTicketHtml, buildReceiptHtml, buildTestPageHtml } from "./layout";
export { RECEIPT_CHANNEL_LABELS, sampleReceiptPayload } from "./receipt-template";
export { buildShiftReportHtml, openShiftReportPrint } from "./shift-snapshot-template";
export { buildShiftReportPayload, buildShiftReportDetail } from "../pos-shift-report";
export type {
  ShiftReportKind,
  ShiftReportPayload,
  ShiftReportSummary,
  ShiftReportDetail,
} from "../pos-shift-report";

export {
  browserPrintJob,
  browserPrintTest,
  canBrowserPrint,
  dispatchJob,
} from "./drivers/browser-print";

export {
  getCachedPrinterSetup,
  getPosPrinterSetup,
  mapPrinterSetup,
  savePosPrinterSetup,
  subscribePosPrinterSetup,
} from "./storage";

export {
  buildKitchenJobs,
  buildReceiptJobs,
  buildSalePrintJobs,
  getPrinterReadiness,
  printOnSaleComplete,
  printSaleDocuments,
  runPrintJobs,
  type PrinterReadiness,
} from "./router";

/** พิมพ์ใบเสร็จลูกค้า — ใช้จากหน้าขาย */
export async function printCustomerReceipt(
  receipt: import("./types").ReceiptPrintPayload,
  deviceId?: string,
): Promise<import("./types").PrintBatchResult> {
  const { printSaleDocuments } = await import("./router");
  return printSaleDocuments(receipt, { deviceId, receiptOnly: true });
}

/** พิมพ์ครบทั้งใบเสร็จ + ครัว/บาร์ (ตามตั้งค่า auto) */
export async function printAfterSale(
  receipt: import("./types").ReceiptPrintPayload,
  deviceId?: string,
): Promise<import("./types").PrintBatchResult> {
  const { printSaleDocuments } = await import("./router");
  return printSaleDocuments(receipt, { deviceId, receiptOnly: false });
}
