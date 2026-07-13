"use client";

import { useMemo, useState } from "react";
import type { MenuOptionGroup } from "@/lib/types";
import {
  computeUnitPrice,
  selectionsFromPicked,
  validateSelections,
  type PosCartSelection,
} from "@/lib/pos-menu-cart";
import { formatPlainNumber } from "@/lib/utils";

export function PosOptionPickerModal({
  itemName,
  basePrice,
  groups,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  basePrice: number;
  groups: MenuOptionGroup[];
  onCancel: () => void;
  onConfirm: (selections: PosCartSelection[], unitPrice: number) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const selections = useMemo(() => selectionsFromPicked(groups, picked), [groups, picked]);
  const unitPrice = computeUnitPrice(basePrice, selections);

  function toggleChoice(group: MenuOptionGroup, optionId: string) {
    setError(null);
    setPicked((prev) => {
      const cur = prev[group.id] || [];
      if (group.selectionType === "single") {
        return { ...prev, [group.id]: [optionId] };
      }
      if (group.selectionType === "unlimited" || group.selectionType === "multi") {
        const has = cur.includes(optionId);
        const next = has ? cur.filter((id) => id !== optionId) : [...cur, optionId];
        return { ...prev, [group.id]: next };
      }
      return prev;
    });
  }

  function handleConfirm() {
    const err = validateSelections(groups, picked);
    if (err) {
      setError(err);
      return;
    }
    onConfirm(selections, unitPrice);
  }

  return (
    <div className="pos-modal-backdrop" role="dialog" aria-modal="true">
      <div className="pos-modal pos-option-picker">
        <header className="pos-modal-head">
          <h2>{itemName}</h2>
          <p className="muted">฿{formatPlainNumber(basePrice)} · เลือกตัวเลือก</p>
        </header>

        <div className="pos-option-picker-body">
          {groups.map((group) => (
            <section key={group.id} className="pos-option-group-block">
              <h3>
                {group.name}
                {group.required ? <span className="pos-option-req"> *</span> : null}
              </h3>
              <ul className="pos-option-choice-list">
                {group.options
                  .filter((o) => o.active)
                  .map((opt) => {
                    const selected = (picked[group.id] || []).includes(opt.id);
                    const multi = group.selectionType !== "single";
                    return (
                      <li key={opt.id}>
                        <button
                          type="button"
                          className={`pos-option-choice-btn ${selected ? "is-selected" : ""}`}
                          onClick={() => toggleChoice(group, opt.id)}
                        >
                          <span className="pos-option-choice-name">{opt.name}</span>
                          {opt.priceDelta > 0 || (opt.priceDeltaMax != null && opt.priceDeltaMax > 0) ? (
                            <span className="pos-option-choice-price">
                              +฿{formatPlainNumber(opt.priceDelta)}
                              {opt.priceDeltaMax != null && opt.priceDeltaMax > opt.priceDelta
                                ? `–${formatPlainNumber(opt.priceDeltaMax)}`
                                : ""}
                            </span>
                          ) : null}
                          {multi ? (
                            <span className="pos-option-check" aria-hidden>
                              {selected ? "✓" : ""}
                            </span>
                          ) : (
                            <span className="pos-option-radio" aria-hidden>
                              {selected ? "●" : "○"}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>

        {error ? <p className="error-text pos-option-picker-error">{error}</p> : null}

        <footer className="pos-modal-foot">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="button" className="primary-btn" onClick={handleConfirm}>
            เพิ่มตะกร้า · ฿{formatPlainNumber(unitPrice)}
          </button>
        </footer>
      </div>
    </div>
  );
}
