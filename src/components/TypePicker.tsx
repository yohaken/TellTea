"use client";

import { labelLedgerType, SAVE_TYPE_OPTIONS } from "@/lib/ledger-labels";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** When value is "auto", show this guessed label. */
  autoHint?: string;
  id?: string;
  label?: string;
};

export function TypePicker({
  value,
  onChange,
  autoHint,
  id = "type-picker",
  label = "ประเภท",
}: Props) {
  return (
    <div className="field">
      <label id={`${id}-label`}>{label}</label>
      <div
        className="suggest-list type-picker-chips"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
      >
        {SAVE_TYPE_OPTIONS.map((key) => {
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? "suggest-chip is-active" : "suggest-chip"}
              onClick={() => onChange(key)}
            >
              {key === "auto" ? "ให้ AI จัด" : labelLedgerType(key)}
            </button>
          );
        })}
      </div>
      {value === "auto" && autoHint ? (
        <p className="muted" style={{ marginTop: "0.25rem", textAlign: "left", fontSize: "0.8rem" }}>
          จะบันทึกเป็น: {labelLedgerType(autoHint)}
        </p>
      ) : value && value !== "auto" ? (
        <p className="muted" style={{ marginTop: "0.25rem", textAlign: "left", fontSize: "0.8rem" }}>
          เลือกแล้ว: {labelLedgerType(value)}
        </p>
      ) : null}
    </div>
  );
}
