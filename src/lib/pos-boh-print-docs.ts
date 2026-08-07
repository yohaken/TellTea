/**
 * Back-office print-document builders — same templates as nPos thermal paper
 * (ReceiptFormBuilder / ShiftReportFormBuilder parity via web HTML forms).
 */
import { saleLinesToLocalReceiptLines, type PosLocalReceipt } from "./pos-local-receipts";
import { summarizeLocalReceipts } from "./pos-local-receipts";
import { localReceiptToPrintPayload } from "./pos-receipt-view";
import { posPairingCodeFromId } from "./pos-devices";
import {
  buildShiftReportPayload,
  type ShiftReportKind,
  type ShiftReportPayload,
} from "./pos-shift-report";
import type { PosShopSettings } from "./pos-settings";
import type { PosSale, PosSession } from "./types";
import { getKindProfile } from "./pos-printer/profiles";
import {
  buildUnifiedReceiptBody,
  unifiedReceiptStyles,
} from "./pos-printer/receipt-template";
import { buildShiftReportHtml } from "./pos-printer/shift-snapshot-template";

export function saleToLocalReceipt(sale: PosSale): PosLocalReceipt {
  const extra = sale as PosSale & {
    customerName?: string;
    customerPhone?: string;
    staffName?: string;
    vatBaht?: number;
    serviceChargeBaht?: number;
  };
  const memberPhone = (sale.memberPhone || "").trim();
  const customerPhone = (extra.customerPhone || memberPhone || "").trim() || undefined;
  const customerName =
    (extra.customerName || "").trim() ||
    (memberPhone || sale.memberId ? "สมาชิก" : "") ||
    undefined;
  return {
    id: sale.id,
    billNo: sale.billNo,
    sessionId: sale.sessionId,
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    linePreview: sale.lines.map((l) => `${l.name}×${l.qty}`).join(", "),
    lines: saleLinesToLocalReceiptLines(sale.lines),
    discountBaht: sale.discountBaht,
    manualDiscountBaht: sale.manualDiscountBaht,
    redeemBaht: sale.redeemBaht,
    pointsRedeemed: sale.pointsRedeemed,
    pointsEarned: sale.pointsEarned,
    cashReceived: sale.cashReceived,
    change: sale.change,
    createdAt: sale.createdAt,
    pending: false,
    voided: sale.status === "voided",
    voidedAt: sale.voidedAt,
    voidReason: sale.voidReason,
    customerName,
    customerPhone,
    staffName: extra.staffName,
    vatBaht: extra.vatBaht,
    serviceChargeBaht: extra.serviceChargeBaht,
  };
}

export function buildBohReceiptPreviewHtml(
  sale: PosSale,
  shop: PosShopSettings,
  opts?: { compact?: boolean; voided?: boolean },
): string {
  const receipt = saleToLocalReceipt(sale);
  const payload = localReceiptToPrintPayload(receipt, shop);
  const layout = getKindProfile(opts?.compact ? "mobile_58" : "builtin_80");
  const body = buildUnifiedReceiptBody(payload, layout);
  const css = unifiedReceiptStyles(layout, "auto");
  const voided = opts?.voided ?? receipt.voided === true;
  const voidBanner = voided
    ? `<div style="text-align:center;font-weight:800;color:#b42318;margin:0 0 8px;">ทำลายแล้ว</div>`
    : "";
  const voidReason =
    voided && receipt.voidReason?.trim()
      ? `<div style="font-size:12px;color:#444;margin-top:8px;border-top:1px dashed #aaa;padding-top:6px;">เหตุผลทำลาย: ${escapeHtml(
          receipt.voidReason.trim(),
        )}</div>`
      : "";
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/><style>
    ${css}
    body{margin:0;background:#fff;}
    .shell{padding:8px 4px 12px;}
  </style></head><body><div class="shell">${voidBanner}${body}${voidReason}</div></body></html>`;
}

export function buildBohSessionReportPayload(
  session: PosSession,
  sales: PosSale[],
  shop: PosShopSettings,
  kind?: ShiftReportKind,
): ShiftReportPayload {
  const receipts = sales
    .filter((s) => s.sessionId === session.id)
    .map(saleToLocalReceipt);
  const fromReceipts = receipts.length > 0 ? summarizeLocalReceipts(receipts) : null;
  const summary = fromReceipts ?? {
    count: session.saleCount || 0,
    total: session.totalSales || 0,
    cashCount: session.cashBillCount || 0,
    cashTotal: session.cashTotal || 0,
    promptpayCount: session.promptpayBillCount || 0,
    promptpayTotal: session.promptpayTotal || 0,
    transferCount: session.transferBillCount || 0,
    transferTotal: session.transferTotal || 0,
    pendingCount: 0,
    voidedCount: session.voidedCount || 0,
  };

  const reportKind: ShiftReportKind =
    kind ?? (session.status === "closed" ? "close" : "snapshot");

  return buildShiftReportPayload({
    kind: reportKind,
    shop,
    deviceCode: posPairingCodeFromId(session.deviceId || session.id),
    sessionId: session.id,
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? null,
    summary,
    receipts,
    openingCash: session.openingCash,
    closingCashCounted: session.closingCashCounted,
    expectedCash: session.expectedCash,
    cashDifference: session.cashDifference,
    leaveFloat: session.leaveFloat,
    discrepancyLabel: session.discrepancyLabel,
    discrepancyNote: session.discrepancyNote,
    cashOutTotal: session.cashOutTotal,
    cashInTotal: session.cashInTotal,
    staffName: session.openedByName?.trim() || shop.receiptStaffName,
    shiftLabel: session.shift?.trim() || undefined,
  });
}

/** Full HTML for iframe preview — no auto-print popup. */
export function buildBohSessionReportPreviewHtml(
  session: PosSession,
  sales: PosSale[],
  shop: PosShopSettings,
  kind?: ShiftReportKind,
): string {
  const payload = buildBohSessionReportPayload(session, sales, shop, kind);
  return buildShiftReportHtml(payload).replace(/<script[\s\S]*?<\/script>/gi, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
