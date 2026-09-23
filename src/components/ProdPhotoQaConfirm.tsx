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
 * Heart of production photo QA: staff must confirm photo matches selected product
 * when AI reports a conflict OR when AI is unavailable (timeout / outage).
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

  return (
    <div
      className={[
        "prod-photo-qa-confirm",
        isOutage ? "is-ai-outage" : "is-conflict",
      ].join(" ")}
      role="alertdialog"
      aria-labelledby="prod-qa-title"
    >
      <h3 id="prod-qa-title" className="prod-photo-qa-confirm-title">
        {isOutage ? "ต้องยืนยันรูปกับสินค้า" : "รูปอาจขัดกับสินค้าที่เลือก"}
      </h3>
      {isOutage ? (
        <p className="prod-photo-qa-confirm-body">
          ตรวจอัตโนมัติไม่สำเร็จ
          {reason ? <> ({reason})</> : null} — ยืนยันว่ารูปที่ถ่ายเป็น{" "}
          <strong>{selectedProductName}</strong> จริงหรือไม่
        </p>
      ) : (
        <p className="prod-photo-qa-confirm-body">
          AI มองว่ารูปใกล้เคียง{" "}
          <strong>{suggestedProductName || "สินค้าอื่นในกลุ่ม"}</strong> มากกว่า{" "}
          <strong>{selectedProductName}</strong>
          {reason ? <> — {reason}</> : null}
        </p>
      )}
      <p className="muted prod-photo-qa-confirm-hint">
        {isOutage
          ? "หัวใจสำคัญ: กดยืนยันเฉพาะเมื่อรูปตรงสินค้าที่เลือก · ถ้าไม่แน่ใจให้เปลี่ยนสินค้าหรือถ่ายใหม่"
          : "ถ้ายืนยันว่าสินค้าที่เลือกถูกต้อง จะบันทึกต่อได้ · ถ้าผิด ให้เปลี่ยนสินค้าแล้วถ่ายใหม่"}
      </p>
      <div className="prod-photo-qa-confirm-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={busy}
          onClick={onConfirmCorrect}
        >
          ยืนยัน — รูปตรงกับ {selectedProductName}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={busy}
          onClick={onRejectChange}
        >
          ไม่ใช่ — เปลี่ยนสินค้า
        </button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={onCancel}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
