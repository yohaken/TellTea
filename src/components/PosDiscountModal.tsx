"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  payableAfterDiscount,
  resolveDiscountBaht,
  type PosCartDiscount,
} from "@/lib/pos-discount";
import { formatPlainNumber } from "@/lib/utils";

const BAHT_PRESETS = [5, 10, 20, 50, 100] as const;
const PCT_PRESETS = [5, 10, 15, 20] as const;
const DIGITS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"] as const;

type Mode = "baht" | "percent";

export function PosDiscountModal({
  subtotal,
  initial,
  onCancel,
  onApply,
}: {
  subtotal: number;
  initial: PosCartDiscount | null;
  onCancel: () => void;
  onApply: (discount: PosCartDiscount | null) => void;
}) {
  const [mode, setMode] = useState<Mode>(initial?.kind === "percent" ? "percent" : "baht");
  const [raw, setRaw] = useState(() => {
    if (!initial || !(initial.value > 0)) return "";
    return String(initial.value);
  });

  useEffect(() => {
    // lock body scroll while open — avoid behind-panel scroll fights
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const typed = Number(raw);
  const draft: PosCartDiscount | null =
    raw && Number.isFinite(typed) && typed > 0
      ? mode === "baht"
        ? { kind: "baht", value: typed }
        : { kind: "percent", value: Math.min(100, typed) }
      : null;

  const cut = resolveDiscountBaht(subtotal, draft);
  const payable = payableAfterDiscount(subtotal, draft);

  function setModeAndKeep(next: Mode) {
    setMode(next);
    setRaw("");
  }

  function appendDigit(d: string) {
    setRaw((prev) => {
      if (mode === "percent") {
        const next = `${prev}${d}`.replace(/^0+(?=\d)/, "");
        const n = Number(next);
        if (n > 100) return prev || "";
        return next.slice(0, 3);
      }
      if (prev.includes(".")) {
        const [a, b = ""] = prev.split(".");
        if (b.length >= 2) return prev;
        return `${a}.${b}${d}`;
      }
      const next = `${prev}${d}`.replace(/^0+(?=\d)/, "");
      return next.slice(0, 7);
    });
  }

  function appendDot() {
    if (mode !== "baht") return;
    setRaw((prev) => (prev.includes(".") ? prev : `${prev || "0"}.`));
  }

  function backspace() {
    setRaw((prev) => prev.slice(0, -1));
  }

  function pickPreset(value: number) {
    setRaw(String(value));
  }

  return (
    <div className="pos-pay-modal pos-discount-modal" role="dialog" aria-modal="true" aria-label="ส่วนลด">
      <div className="pos-pay-sheet pos-discount-sheet">
        <div className="pos-pay-sheet-inner">
          <div className="pos-pay-sheet-top">
            <div className="pos-pay-head">
              <h2>ส่วนลด</h2>
              <button type="button" className="ghost-btn" aria-label="ปิด" onClick={onCancel}>
                <X size={18} />
              </button>
            </div>
            <p className="pos-pay-summary">ยอดก่อนลด ฿{formatPlainNumber(subtotal)} · กดปุ่มอย่างเดียว ไม่ใช้แป้นพิมพ์</p>
          </div>

          <div className="pos-pay-sheet-body pos-discount-body">
            <div className="pos-discount-mode" role="tablist" aria-label="ประเภทส่วนลด">
              <button
                type="button"
                role="tab"
                className={mode === "baht" ? "is-active" : ""}
                onClick={() => setModeAndKeep("baht")}
              >
                บาท
              </button>
              <button
                type="button"
                role="tab"
                className={mode === "percent" ? "is-active" : ""}
                onClick={() => setModeAndKeep("percent")}
              >
                เปอร์เซ็นต์
              </button>
            </div>

            <div className="pos-discount-display" aria-live="polite">
              <span className="pos-discount-display-label">{mode === "baht" ? "ลดเป็นบาท" : "ลดเป็น %"}</span>
              <strong className="pos-discount-display-value">
                {raw ? (mode === "baht" ? `฿${raw}` : `${raw}%`) : "—"}
              </strong>
            </div>

            <div className="pos-discount-presets" role="group" aria-label="ค่าที่ใช้บ่อย">
              {(mode === "baht" ? BAHT_PRESETS : PCT_PRESETS).map((v) => (
                <button
                  key={`${mode}-${v}`}
                  type="button"
                  className="pos-discount-preset"
                  onClick={() => pickPreset(v)}
                >
                  {mode === "baht" ? `฿${v}` : `${v}%`}
                </button>
              ))}
            </div>

            <div className="pos-discount-pad" role="group" aria-label="ตัวเลขส่วนลด">
              {DIGITS.map((d) => (
                <button key={d} type="button" className="pos-cash-keypad-digit" onClick={() => appendDigit(d)}>
                  {d}
                </button>
              ))}
              {mode === "baht" ? (
                <button type="button" className="pos-cash-keypad-digit" onClick={appendDot}>
                  .
                </button>
              ) : (
                <button type="button" className="pos-cash-keypad-digit" disabled>
                  %
                </button>
              )}
              <button type="button" className="pos-cash-keypad-digit" onClick={() => appendDigit("0")}>
                0
              </button>
              <button type="button" className="pos-cash-keypad-digit" onClick={backspace} aria-label="ลบตัวเลข">
                ⌫
              </button>
            </div>

            <p className={`pos-discount-result ${cut > 0 ? "ok-text" : "muted"}`}>
              {cut > 0
                ? `ลด ฿${formatPlainNumber(cut)} → เหลือ ฿${formatPlainNumber(payable)}`
                : "ยังไม่ได้ใส่ส่วนลด"}
            </p>
          </div>
        </div>

        <div className="pos-pay-actions">
          <button type="button" className="pos-pay-cancel-btn" onClick={() => onApply(null)}>
            ล้างส่วนลด
          </button>
          <button
            type="button"
            className="pos-btn-orange pos-pay-confirm-btn"
            onClick={() => onApply(draft)}
          >
            ใช้ส่วนลด
          </button>
        </div>
      </div>
    </div>
  );
}
