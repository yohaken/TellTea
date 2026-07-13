import type { PosSaleLine, PosSalePaymentMethod } from "../types";

/** ประเภทเครื่องพิมพ์ตามการใช้งานในร้าน */
export type PrinterKind = "builtin_80" | "desktop_80" | "mobile_58";

/** ช่องทางเชื่อมต่อ */
export type PrinterConnection = "builtin" | "lan" | "wifi" | "usb" | "bluetooth" | "browser";

/** บทบาทการพิมพ์ — กำหนดว่าจะรับงานประเภทใด */
export type PrinterRole = "receipt" | "kitchen" | "bar" | "mobile";

export type PaperWidthMm = 58 | 80;

export type CutMode = "auto" | "manual";

export type PosPrinterConfig = {
  id: string;
  name: string;
  kind: PrinterKind;
  role: PrinterRole;
  connection: PrinterConnection;
  paperWidthMm: PaperWidthMm;
  cutMode: CutMode;
  enabled: boolean;
  /** LAN/Wi-Fi — host หรือ IP (เฟสถัดไป) */
  networkHost?: string;
  networkPort?: number;
  /** หมวดเมนูที่ส่งมาครัวนี้ (ว่าง = ทุกหมวด) */
  categoryIds?: string[];
  sortOrder: number;
};

export type PosPrinterSetup = {
  printers: PosPrinterConfig[];
  /** deviceId → printer id สำหรับใบเสร็จบนเครื่องนั้น */
  deviceReceiptPrinter: Record<string, string>;
  autoPrintKitchen: boolean;
  autoPrintBar: boolean;
};

export type PrintJobKind = "receipt" | "kitchen_ticket" | "bar_ticket";

/** ช่องทางออเดอร์ — ใช้สลิปรูปแบบเดียว ปรับหัวสลิปตามช่องทาง */
export type ReceiptOrderChannel =
  | "dine_in"
  | "takeaway"
  | "shopeefood"
  | "lineman"
  | "grab"
  | "other";

export type ReceiptPrintPayload = {
  kind: "receipt";
  shopName: string;
  shopNameTh?: string;
  shopAddress?: string;
  shopPhone?: string;
  billNo: string;
  lines: PosSaleLine[];
  total: number;
  subtotal?: number;
  discountBaht?: number;
  paymentMethod: PosSalePaymentMethod;
  cashReceived?: number;
  change?: number;
  createdAt: number;
  orderChannel?: ReceiptOrderChannel;
  customerName?: string;
  externalOrderId?: string;
  staffName?: string;
  staffId?: string;
  orderNotes?: string;
  receiptFooterNote?: string;
};

export type KitchenTicketPrintPayload = {
  kind: "kitchen_ticket" | "bar_ticket";
  billNo: string;
  lines: PosSaleLine[];
  createdAt: number;
  stationLabel?: string;
};

export type PrintPayload = ReceiptPrintPayload | KitchenTicketPrintPayload;

export type PrintJob = {
  id: string;
  printer: PosPrinterConfig;
  payload: PrintPayload;
};

export type PrintResult = {
  jobId: string;
  printerId: string;
  printerName: string;
  ok: boolean;
  error?: string;
};

export type PrintBatchResult = {
  results: PrintResult[];
  printed: number;
  failed: number;
};
