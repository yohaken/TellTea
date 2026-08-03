"use client";

import { useMemo } from "react";
import { Printer, Trash2 } from "lucide-react";
import type { PosLocalReceipt } from "@/lib/pos-local-receipts";
import { localReceiptToPrintPayload } from "@/lib/pos-receipt-view";
import {
  buildUnifiedReceiptBody,
  getKindProfile,
  unifiedReceiptStyles,
} from "@/lib/pos-printer";
import {
  getLocalPosShopSettings,
  type PosShopSettings,
} from "@/lib/pos-settings";
import { PosPrintDocFrame } from "@/components/PosPrintDocFrame";

/**
 * Back-office / history bill detail — same field order & labels as thermal
 * (`buildUnifiedReceiptBody` / native ReceiptFormBuilder).
 */
export function PosReceiptPaper({
  receipt,
  compact = false,
  shop,
  onPrint,
  onVoid,
  voidBusy,
}: {
  receipt: PosLocalReceipt;
  compact?: boolean;
  shop?: Pick<
    PosShopSettings,
    | "shopName"
    | "shopNameTh"
    | "shopAddress"
    | "shopPhone"
    | "taxId"
    | "receiptStaffName"
    | "receiptFooterNote"
  >;
  onPrint?: () => void;
  onVoid?: () => void;
  voidBusy?: boolean;
}) {
  const voided = receipt.voided === true;
  const showActions = Boolean(onPrint || onVoid);
  const shopSettings = shop ?? getLocalPosShopSettings();

  const previewHtml = useMemo(() => {
    const payload = localReceiptToPrintPayload(receipt, shopSettings);
    const layout = getKindProfile(compact ? "mobile_58" : "builtin_80");
    const body = buildUnifiedReceiptBody(payload, layout);
    const css = unifiedReceiptStyles(layout, "auto");
    const voidBanner = voided
      ? `<div style="text-align:center;font-weight:800;color:#b42318;margin:0 0 8px;letter-spacing:0.04em;">ทำลายแล้ว</div>`
      : "";
    const pendingBanner = receipt.pending
      ? `<div style="text-align:center;font-size:12px;color:#a15c00;margin:0 0 6px;">รอส่งข้อมูล</div>`
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
      .pos-receipt-preview-shell{padding:8px 4px 12px;}
    </style></head><body><div class="pos-receipt-preview-shell">${voidBanner}${pendingBanner}${body}${voidReason}</div></body></html>`;
  }, [compact, receipt, shopSettings, voided]);

  return (
    <div className={`pos-receipt-paper-wrap ${compact ? "pos-receipt-paper-wrap--compact" : ""}`}>
      <div
        className={`pos-receipt-paper pos-receipt-paper--print-parity ${voided ? "is-voided" : ""}`}
        aria-label={`ใบเสร็จ ${receipt.billNo}`}
      >
        <PosPrintDocFrame
          html={previewHtml}
          title={`ใบเสร็จ ${receipt.billNo}`}
          tall={!compact}
        />
      </div>

      {showActions ? (
        <div className="pos-receipt-paper-actions">
          {onPrint ? (
            <button
              type="button"
              className="pos-btn-orange pos-receipt-action-btn"
              onClick={onPrint}
              disabled={voided}
            >
              <Printer size={20} aria-hidden />
              พิมพ์ใบเสร็จ
            </button>
          ) : null}
          {onVoid ? (
            <button
              type="button"
              className="pos-btn-orange pos-receipt-action-btn pos-receipt-action-btn--void"
              onClick={onVoid}
              disabled={voided || voidBusy}
            >
              <Trash2 size={20} aria-hidden />
              {voidBusy ? "กำลังทำลาย..." : "ทำลายบิล (Void)"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
