"use client";

import type { ProdPhotoQaConfirmKind } from "@/lib/prod-photo-qa";

type Props = {
  kind: ProdPhotoQaConfirmKind;
  selectedProductName: string;
  suggestedProductName?: string;
  reason?: string;
  busy?: boolean;
  onConfirmCorrect: () => void;
  onRejectChange: () => void;
  onCancel: () => void;
};

/**
 * Mini compact confirm — photo matches product (conflict or AI outage).
 */
export function ProdPhotoQaConfirm({
  kind,
  selectedProductName,
  suggestedProductName,
  reason,
  busy,
  onConfirmCorrect,
  onRejectChange,
  onCancel,
}: Props) {
  const isOutage = kind === "ai_unavailable";
  const shortName =
    selectedProductName.length > 18
      ? `${selectedProductName.slice(0, 16)}…`
      : selectedProductName;

  return (
    <div
      className={[
        "prod-photo-qa-confirm",
        "is-slim",
        isOutage ? "is-ai-outage" : "is-conflict",
      ].join(" ")}
      role="alertdialog"
      aria-labelledby="prod-qa-title"
    >
      <h3 id="prod-qa-title" className="prod-photo-qa-confirm-title">
        {isOutage ? "ยืนยันรูป=สินค้า" : "รูปอาจไม่ตรง"}
      </h3>
      <p className="prod-photo-qa-confirm-body">
        {isOutage ? (
          <>
            AI ไม่สรุปได้{reason ? ` · ${reason}` : ""} — รูปเป็น{" "}
            <strong>{selectedProductName}</strong> จริงไหม?
          </>
        ) : (
          <>
            AI ใกล้ <strong>{suggestedProductName || "สินค้าอื่น"}</strong> มากกว่า{" "}
            <strong>{selectedProductName}</strong>
            {reason ? ` · ${reason}` : ""}
          </>
        )}
      </p>
      <div className="prod-photo-qa-confirm-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={busy}
          onClick={onConfirmCorrect}
        >
          ตรง · {shortName}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={busy}
          onClick={onRejectChange}
        >
          เปลี่ยนสินค้า
        </button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={onCancel}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
