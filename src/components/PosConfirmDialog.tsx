"use client";

import { useEffect, useId, useRef } from "react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export type PosConfirmDialogProps = {
  open: boolean;
  title: string;
  message?: string;
  /** ข้อความหลายบรรทัด (เช่น สรุปออกงาน) */
  detail?: string;
  variant?: "confirm" | "prompt" | "alert";
  promptLabel?: string;
  promptPlaceholder?: string;
  promptValue?: string;
  onPromptChange?: (value: string) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function PosConfirmDialog({
  open,
  title,
  message,
  detail,
  variant = "confirm",
  promptLabel = "เหตุผล",
  promptPlaceholder = "ไม่บังคับ",
  promptValue = "",
  onPromptChange,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: PosConfirmDialogProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (open && variant === "prompt") {
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, variant]);

  if (!open) return null;

  const primaryLabel =
    confirmLabel || (variant === "alert" ? "ตกลง" : destructive ? "ยืนยัน" : "ตกลง");

  return (
    <div className="pos-confirm-modal" role="presentation" onClick={onCancel}>
      <div
        className="pos-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        {message ? <p className="pos-confirm-message">{message}</p> : null}
        {detail ? <pre className="pos-confirm-detail">{detail}</pre> : null}
        {variant === "prompt" ? (
          <label className="pos-confirm-field">
            <span>{promptLabel}</span>
            <input
              ref={inputRef}
              type="text"
              value={promptValue}
              placeholder={promptPlaceholder}
              onChange={(e) => onPromptChange?.(e.target.value)}
            />
          </label>
        ) : null}
        <div className="pos-confirm-actions">
          {variant !== "alert" ? (
            <button type="button" className="ghost-btn" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={destructive ? "pos-btn-orange" : "primary-btn"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "กำลังทำ..." : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
