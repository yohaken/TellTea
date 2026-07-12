"use client";

import { useMemo, useState } from "react";
import {
  BASE_TYPE_OPTIONS,
  filterTypeOptions,
  labelLedgerType,
} from "@/lib/ledger-labels";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Extra type keys seen in history (e.g. from entries). */
  frequent?: string[];
  /** When value is "auto", show this guessed label. */
  autoHint?: string;
  id?: string;
  label?: string;
};

export function TypePicker({
  value,
  onChange,
  frequent = [],
  autoHint,
  id = "type-picker",
  label = "ประเภท",
}: Props) {
  const [query, setQuery] = useState("");

  const chips = useMemo(() => {
    const base = BASE_TYPE_OPTIONS.map((o) => o.value);
    const merged = ["auto", ...frequent, ...base];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of merged) {
      const k = key.trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return filterTypeOptions(out, query).slice(0, 12);
  }, [frequent, query]);

  const displayValue =
    value === "auto"
      ? "auto"
      : BASE_TYPE_OPTIONS.some((o) => o.value === value)
        ? value
        : value || "อื่นๆ";

  const customQ = query.trim();
  const showCustom =
    Boolean(customQ) &&
    customQ.toLowerCase() !== "auto" &&
    !chips.some((c) => c.toLowerCase() === customQ.toLowerCase());

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ค้นหาประเภท…"
        autoComplete="off"
      />
      {chips.length > 0 || showCustom ? (
        <div className="suggest-list" role="listbox" aria-label="ประเภทที่ใช้บ่อย">
          {chips.map((key) => {
            const active = displayValue === key || (key === "auto" && value === "auto");
            return (
              <button
                key={key}
                type="button"
                className={active ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => {
                  onChange(key);
                  setQuery("");
                }}
              >
                {key === "auto" ? "อัตโนมัติ" : labelLedgerType(key)}
              </button>
            );
          })}
          {showCustom ? (
            <button
              type="button"
              className="suggest-chip"
              onClick={() => {
                onChange(customQ);
                setQuery("");
              }}
            >
              ใช้ «{customQ}»
            </button>
          ) : null}
        </div>
      ) : null}
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
