"use client";

import { Printer, Trash2 } from "lucide-react";
import type { PosLocalReceipt } from "@/lib/pos-local-receipts";
import {
  receiptQtyEmphasized,
  tallyLocalLineModifiers,
} from "@/lib/pos-receipt-format";
import {
  localReceiptLines,
  receiptDiscountBaht,
  receiptSubtotal,
} from "@/lib/pos-receipt-view";
import { formatPlainNumber } from "@/lib/utils";

function formatReceiptDate(ts: number) {
  return new Date(ts).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PosReceiptPaper({
  receipt,
  compact = false,
  onPrint,
  onVoid,
  voidBusy,
}: {
  receipt: PosLocalReceipt;
  compact?: boolean;
  onPrint?: () => void;
  onVoid?: () => void;
  voidBusy?: boolean;
}) {
  const lines = localReceiptLines(receipt);
  const subtotal = receiptSubtotal(lines);
  const discountBaht = receiptDiscountBaht(receipt);
  const voided = receipt.voided === true;
  const showActions = Boolean(onPrint || onVoid);

  return (
    <div className={`pos-receipt-paper-wrap ${compact ? "pos-receipt-paper-wrap--compact" : ""}`}>
      <article
        className={`pos-receipt-paper ${voided ? "is-voided" : ""}`}
        aria-label={`ใบเสร็จ ${receipt.billNo}`}
      >
        <div className="pos-receipt-paper-zigzag" aria-hidden />

        {!compact ? (
          <header className="pos-receipt-paper-head">
            <p className="pos-receipt-paper-total-label">ยอดขาย</p>
            <p className="pos-receipt-paper-total">฿{formatPlainNumber(receipt.total)}</p>
            {voided ? <span className="pos-receipt-paper-void-badge">ทำลายแล้ว</span> : null}
          </header>
        ) : null}

        <section className="pos-receipt-paper-section">
          <h3>{compact ? `บิล #${receipt.billNo}` : "ข้อมูลใบเสร็จ"}</h3>
          <dl className="pos-receipt-paper-meta">
            {!compact ? (
              <div>
                <dt>เลขบิล</dt>
                <dd>#{receipt.billNo}</dd>
              </div>
            ) : null}
            <div>
              <dt>ชำระโดย</dt>
              <dd>{receipt.paymentMethod === "cash" ? "เงินสด" : "PromptPay"}</dd>
            </div>
            <div>
              <dt>วันที่</dt>
              <dd>{formatReceiptDate(receipt.createdAt)}</dd>
            </div>
            {receipt.paymentMethod === "cash" && receipt.cashReceived != null ? (
              <>
                <div>
                  <dt>รับเงิน</dt>
                  <dd>฿{formatPlainNumber(receipt.cashReceived)}</dd>
                </div>
                <div>
                  <dt>ทอน</dt>
                  <dd>฿{formatPlainNumber(receipt.change ?? 0)}</dd>
                </div>
              </>
            ) : null}
            {receipt.pending ? (
              <div>
                <dt>สถานะ</dt>
                <dd className="pos-receipt-paper-pending">รอส่งข้อมูล</dd>
              </div>
            ) : null}
            {voided && receipt.voidReason ? (
              <div>
                <dt>เหตุผลทำลาย</dt>
                <dd>{receipt.voidReason}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="pos-receipt-paper-section">
          <h3>รายการอาหาร</h3>
          <ul className="pos-receipt-paper-items">
            {lines.map((line, idx) => {
              const mods = tallyLocalLineModifiers(line);
              const lineTotal = line.unitPrice * line.qty;
              const emphasizeQty = receiptQtyEmphasized(line.qty);
              return (
                <li key={`${receipt.id}-${idx}`} className="pos-receipt-paper-item">
                  <div className="pos-receipt-paper-item-head">
                    {emphasizeQty ? (
                      <span className="pos-receipt-paper-item-qty-badge">×{line.qty}</span>
                    ) : null}
                    <div className="pos-receipt-paper-item-main">
                      <span className="pos-receipt-paper-item-name">{line.name}</span>
                      <span className="pos-receipt-paper-item-price">
                        {formatPlainNumber(lineTotal)}
                      </span>
                    </div>
                  </div>
                  {mods.map((mod) => (
                    <p key={`${idx}-${mod.label}`} className="pos-receipt-paper-mod">
                      · {mod.label}
                      {mod.count > 1 ? (
                        <strong className="pos-receipt-paper-mod-qty"> ×{mod.count}</strong>
                      ) : null}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="pos-receipt-paper-section pos-receipt-paper-totals">
          <div className="pos-receipt-paper-total-row">
            <span>ราคาอาหารรวม</span>
            <span>{formatPlainNumber(subtotal)}</span>
          </div>
          {discountBaht > 0 ? (
            <div className="pos-receipt-paper-total-row pos-receipt-paper-total-row--discount">
              <span>ส่วนลด</span>
              <span>-{formatPlainNumber(discountBaht)}</span>
            </div>
          ) : null}
          <div className="pos-receipt-paper-total-row pos-receipt-paper-total-row--grand">
            <span>ยอดสุทธิ</span>
            <strong>{formatPlainNumber(receipt.total)}</strong>
          </div>
        </section>
      </article>

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
