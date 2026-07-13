"use client";

import { useMemo, useState } from "react";
import type { MenuOptionGroup } from "@/lib/types";
import {
  computeUnitPrice,
  isSweetnessGroup,
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
  onConfirm: (selections: PosCartSelection[], unitPrice: number, qty: number) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const selections = useMemo(() => selectionsFromPicked(groups, picked), [groups, picked]);
  const unitPrice = computeUnitPrice(basePrice, selections);
  const lineTotal = Math.round(unitPrice * qty * 100) / 100;

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
    onConfirm(selections, unitPrice, qty);
  }

  return (
    <div className="pos-modal-backdrop pos-modal-backdrop--center" role="dialog" aria-modal="true">
      <div className="pos-modal pos-option-picker pos-option-picker--foodstory">
        <header className="pos-option-picker-head">
          <h2>{itemName}</h2>
          <div className="pos-option-picker-meta">
            <span className="pos-option-picker-price">฿{formatPlainNumber(basePrice)}</span>
            <div className="pos-option-qty" aria-label="จำนวน">
              <button type="button" className="pos-option-qty-btn" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))}>
                −
              </button>
              <span>{qty}</span>
              <button type="button" className="pos-option-qty-btn" onClick={() => setQty((n) => n + 1)}>
                +
              </button>
            </div>
          </div>
        </header>

        <div className="pos-option-picker-body">
          {groups.length > 1 ? <p className="pos-option-picker-lead">เลือกตัวเลือก</p> : null}
          {groups.map((group) => {
            const sweet = isSweetnessGroup(group);
            return (
              <section key={group.id} className={`pos-option-group-block ${sweet ? "is-sweetness" : ""}`}>
                <h3>
                  {group.name}
                  {group.required ? <span className="pos-option-req"> *</span> : null}
                </h3>
                {sweet ? (
                  <div className="pos-option-sweet-row" role="list">
                    {group.options.map((opt) => {
                      const selected = (picked[group.id] || []).includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="listitem"
                          className={`pos-option-sweet-btn ${selected ? "is-selected" : ""}`}
                          onClick={() => toggleChoice(group, opt.id)}
                        >
                          {opt.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <ul className="pos-option-choice-list">
                    {group.options.map((opt) => {
                      const selected = (picked[group.id] || []).includes(opt.id);
                      const multi = group.selectionType !== "single";
                      const price =
                        opt.priceDelta > 0 || (opt.priceDeltaMax != null && opt.priceDeltaMax > 0)
                          ? `+${formatPlainNumber(opt.priceDelta)}`
                          : "+0";
                      return (
                        <li key={opt.id}>
                          <button
                            type="button"
                            className={`pos-option-choice-btn ${selected ? "is-selected" : ""}`}
                            onClick={() => toggleChoice(group, opt.id)}
                          >
                            <span className="pos-option-choice-control" aria-hidden>
                              {multi ? (selected ? "☑" : "☐") : selected ? "●" : "○"}
                            </span>
                            <span className="pos-option-choice-name">{opt.name}</span>
                            <span className="pos-option-choice-price">{price}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        {error ? <p className="error-text pos-option-picker-error">{error}</p> : null}

        <footer className="pos-modal-foot pos-option-picker-foot">
          <button type="button" className="ghost-btn pos-option-cancel-btn" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="button" className="pos-btn-orange pos-option-confirm-btn" onClick={handleConfirm}>
            ตกลง · ฿{formatPlainNumber(lineTotal)}
          </button>
        </footer>
      </div>
    </div>
  );
}
