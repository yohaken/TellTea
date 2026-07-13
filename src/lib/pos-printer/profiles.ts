import type { CutMode, PaperWidthMm, PosPrinterConfig, PrinterConnection, PrinterKind, PrinterRole } from "./types";

export type PrinterKindProfile = {
  kind: PrinterKind;
  label: string;
  description: string;
  paperWidthMm: PaperWidthMm;
  cutMode: CutMode;
  defaultConnection: PrinterConnection;
  defaultRole: PrinterRole;
  /** ความเร็วพิมพ์โดยประมาณ mm/s */
  speedMmPerSec?: number;
  popupWidthPx: number;
  charsPerLine: number;
  bodyFontPx: number;
  titleFontPx: number;
  metaFontPx: number;
};

export const PRINTER_KIND_PROFILES: Record<PrinterKind, PrinterKindProfile> = {
  builtin_80: {
    kind: "builtin_80",
    label: "Built-in 80mm",
    description: "ติดมากับเครื่อง POS · ตัดกระดาษอัตโนมัติ · ใบเสร็จแคชเชียร์",
    paperWidthMm: 80,
    cutMode: "auto",
    defaultConnection: "builtin",
    defaultRole: "receipt",
    speedMmPerSec: 225,
    popupWidthPx: 302,
    charsPerLine: 42,
    bodyFontPx: 14,
    titleFontPx: 17,
    metaFontPx: 12,
  },
  desktop_80: {
    kind: "desktop_80",
    label: "Desktop 80mm",
    description: "ตั้งโต๊ะแยก · LAN/Wi-Fi/USB · ใบสั่งครัว/บาร์",
    paperWidthMm: 80,
    cutMode: "auto",
    defaultConnection: "lan",
    defaultRole: "kitchen",
    popupWidthPx: 302,
    charsPerLine: 42,
    bodyFontPx: 14,
    titleFontPx: 17,
    metaFontPx: 12,
  },
  mobile_58: {
    kind: "mobile_58",
    label: "Mobile 58mm",
    description: "พกพา · บลูทูธ · ฉีกกระดาษ · รับออเดอร์เดินโต๊ะ",
    paperWidthMm: 58,
    cutMode: "manual",
    defaultConnection: "bluetooth",
    defaultRole: "mobile",
    popupWidthPx: 220,
    charsPerLine: 32,
    bodyFontPx: 12,
    titleFontPx: 14,
    metaFontPx: 10,
  },
};

export const PRINTER_ROLE_LABELS: Record<PrinterRole, string> = {
  receipt: "ใบเสร็จ (แคชเชียร์)",
  kitchen: "ครัว",
  bar: "บาร์น้ำ",
  mobile: "พกพา / เดลิเวอรี",
};

export const PRINTER_CONNECTION_LABELS: Record<PrinterConnection, string> = {
  builtin: "ติดเครื่อง POS",
  lan: "LAN (Ethernet)",
  wifi: "Wi-Fi",
  usb: "USB",
  bluetooth: "Bluetooth",
  browser: "เบราว์เซอร์ (ทดสอบ)",
};

let nextId = 0;

export function newPrinterId(): string {
  nextId += 1;
  return `pr_${Date.now().toString(36)}_${nextId}`;
}

export function createPrinterFromKind(
  kind: PrinterKind,
  overrides?: Partial<Pick<PosPrinterConfig, "name" | "role" | "connection">>,
): PosPrinterConfig {
  const profile = PRINTER_KIND_PROFILES[kind];
  return {
    id: newPrinterId(),
    name: overrides?.name ?? profile.label,
    kind,
    role: overrides?.role ?? profile.defaultRole,
    connection: overrides?.connection ?? profile.defaultConnection,
    paperWidthMm: profile.paperWidthMm,
    cutMode: profile.cutMode,
    enabled: true,
    sortOrder: 0,
  };
}

export function defaultPrinterSetup(): import("./types").PosPrinterSetup {
  return {
    printers: [
      createPrinterFromKind("builtin_80", { name: "ใบเสร็จแคชเชียร์" }),
    ],
    deviceReceiptPrinter: {},
    autoPrintKitchen: false,
    autoPrintBar: false,
  };
}

export function getKindProfile(kind: PrinterKind): PrinterKindProfile {
  return PRINTER_KIND_PROFILES[kind];
}

export function getLayoutForPrinter(printer: PosPrinterConfig): PrinterKindProfile {
  const base = PRINTER_KIND_PROFILES[printer.kind];
  if (printer.paperWidthMm === base.paperWidthMm) return base;
  return printer.paperWidthMm === 58 ? PRINTER_KIND_PROFILES.mobile_58 : PRINTER_KIND_PROFILES.desktop_80;
}
