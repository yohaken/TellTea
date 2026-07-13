import { formatPlainNumber } from "./utils";
import type { PosShopSettings } from "./pos-settings";

export type ShiftReportKind = "snapshot" | "close";

export type ShiftReportSummary = {
  count: number;
  total: number;
  cashCount: number;
  cashTotal: number;
  promptpayCount: number;
  promptpayTotal: number;
  pendingCount: number;
  voidedCount: number;
};

export type ShiftReportPayload = {
  kind: ShiftReportKind;
  shopName: string;
  shopNameTh?: string;
  shopAddress?: string;
  shopPhone?: string;
  deviceCode: string;
  sessionId: string;
  openedAt: number;
  closedAt?: number | null;
  printedAt: number;
  staffName?: string;
  summary: ShiftReportSummary;
};

export function buildShiftReportPayload(input: {
  kind: ShiftReportKind;
  shop: PosShopSettings;
  deviceCode: string;
  sessionId: string;
  openedAt: number;
  closedAt?: number | null;
  summary: ShiftReportSummary;
}): ShiftReportPayload {
  return {
    kind: input.kind,
    shopName: input.shop.shopName,
    shopNameTh: input.shop.shopNameTh,
    shopAddress: input.shop.shopAddress,
    shopPhone: input.shop.shopPhone,
    deviceCode: input.deviceCode,
    sessionId: input.sessionId,
    openedAt: input.openedAt,
    closedAt: input.closedAt ?? null,
    printedAt: Date.now(),
    staffName: input.shop.receiptStaffName,
    summary: input.summary,
  };
}
