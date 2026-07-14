"use client";

import { useMemo, useState } from "react";
import type { MenuOptionGroup } from "@/lib/types";
import {
  computeUnitPrice,
  groupMaxUnits,
  groupTotalUnits,
  groupUsesQuantitySteppers,
  isSweetnessGroup,
  MAX_OPTION_UNITS_PER_CHOICE,
  selectionsFromCounts,
  selectionsToCounts,
  validatePickedCounts,
  type PickedCounts,
  type PosCartSelection,
} from "@/lib/pos-menu-cart";
import { formatPlainNumber } from "@/lib/utils";
import { PosLazyMenuImage } from "@/components/PosLazyMenuImage";

function groupHint(group: MenuOptionGroup): string | null {
  if (isSweetnessGroup(group)) return "เลือก 1 ระดับ";
  if (group.selectionType === "single") return "เลือก 1 อย่าง";
  if (group.selectionType === "unlimited") return "เลือกได้หลายหน่วย (กด + เพิ่ม)";
  const max = groupMaxUnits(group);
  if (max != null && max > 1) return `เลือกรวมได้ไม่เกิน ${max} หน่วย`;
  return null;
}

export function PosOptionPickerModal({
  itemName,
  imageUrl,
  basePrice,
  groups,
  initialSelections,
  initialQty = 1,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  imageUrl?: string | null;
  basePrice: number;
  groups: MenuOptionGroup[];
  initialSelections?: PosCartSelection[];
  initialQty?: number;
  onCancel: () => void;
  onConfirm: (selections: PosCartSelection[], unitPrice: number, qty: number) => void;
}) {
  const [pickedCounts, setPickedCounts] = useState<PickedCounts>(() =>
    initialSelections?.length ? selectionsToCounts(initialSelections) : {},
  );
  const [qty, setQty] = useState(initialQty);
  const [error, setError] = useState<string | null>(null);

  const selections = useMemo(() => selectionsFromCounts(groups, pickedCounts), [groups, pickedCounts]);
  const unitPrice = computeUnitPrice(basePrice, selections);
  const lineTotal = Math.round(unitPrice * qty * 100) / 100;

  function setSingleChoice(group: MenuOptionGroup, optionId: string) {
    setError(null);
    setPickedCounts((prev) => ({ ...prev, [group.id]: { [optionId]: 1 } }));
  }

  function bumpChoice(group: MenuOptionGroup, optionId: string, delta: number) {
    setError(null);
    setPickedCounts((prev) => {
      const gc = { ...(prev[group.id] || {}) };
      const cur = gc[optionId] || 0;
      const nextVal = Math.max(0, Math.min(MAX_OPTION_UNITS_PER_CHOICE, cur + delta));
      if (nextVal === 0) delete gc[optionId];
      else gc[optionId] = nextVal;

      const draft: PickedCounts = { ...prev, [group.id]: gc };
      const total = groupTotalUnits(group, draft);
      const max = groupMaxUnits(group);

      if (delta > 0 && max != null && total > max) {
        return prev;
      }

      const next = { ...prev };
      if (Object.keys(gc).length) next[group.id] = gc;
      else delete next[group.id];
      return next;
    });
  }

  function handleConfirm() {
    const err = validatePickedCounts(groups, pickedCounts);
    if (err) {
      setError(err);
      return;
    }
    onConfirm(selections, unitPrice, qty);
  }

  return (
    <div className="pos-modal-backdrop pos-modal-backdrop--center" role="dialog" aria-modal="true">
      <div className="pos-modal pos-option-picker pos-option-picker--foodstory">
        <header className="pos-option-picker-hero">
          <div className="pos-option-picker-thumb" aria-hidden>
            <PosLazyMenuImage
              url={imageUrl}
              className="pos-option-picker-thumb-img"
              placeholderClassName="pos-option-picker-thumb-ph"
            />
          </div>
          <div className="pos-option-picker-hero-text">
            <h2>{itemName}</h2>
            <div className="pos-option-picker-meta">
              <span className="pos-option-picker-price">฿{formatPlainNumber(basePrice)}</span>
              <div className="pos-option-qty" aria-label="จำนวน">
                <button
                  type="button"
                  className="pos-option-qty-btn"
                  disabled={qty <= 1}
                  onClick={() => setQty((n) => Math.max(1, n - 1))}
                >
                  −
                </button>
                <span>{qty}</span>
                <button type="button" className="pos-option-qty-btn" onClick={() => setQty((n) => n + 1)}>
                  +
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="pos-option-picker-body">
          {groups.length > 1 ? <p className="pos-option-picker-lead">เลือกตัวเลือก</p> : null}
          {groups.map((group) => {
            const sweet = isSweetnessGroup(group);
            const steppers = groupUsesQuantitySteppers(group);
            const hint = groupHint(group);
            const gc = pickedCounts[group.id] || {};
            return (
              <section
                key={group.id}
                className={`pos-option-group-block ${sweet ? "is-sweetness" : ""} ${group.required ? "is-required" : ""}`}
              >
                <h3>
                  {group.name}
                  {hint ? <span className="pos-option-group-hint">{hint}</span> : null}
                </h3>
                {sweet ? (
                  <div className="pos-option-sweet-row" role="list">
                    {group.options.map((opt) => {
                      const selected = (gc[opt.id] || 0) > 0;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="listitem"
                          className={`pos-option-sweet-btn ${selected ? "is-selected" : ""}`}
                          onClick={() => setSingleChoice(group, opt.id)}
                        >
                          {opt.name}
                        </button>
                      );
                    })}
                  </div>
                ) : steppers ? (
                  <ul className="pos-option-choice-list pos-option-choice-list--stepper">
                    {group.options.map((opt) => {
                      const count = gc[opt.id] || 0;
                      const price =
                        opt.priceDelta > 0 || (opt.priceDeltaMax != null && opt.priceDeltaMax > 0)
                          ? `+${formatPlainNumber(opt.priceDelta)}`
                          : "+0";
                      return (
                        <li key={opt.id}>
                          <div className={`pos-option-stepper-row ${count > 0 ? "is-selected" : ""}`}>
                            <span className="pos-option-choice-name">{opt.name}</span>
                            <span className="pos-option-choice-price">{price}</span>
                            <div className="pos-option-stepper">
                              <button
                                type="button"
                                className="pos-option-stepper-btn"
                                aria-label={`ลด ${opt.name}`}
                                disabled={count <= 0}
                                onClick={() => bumpChoice(group, opt.id, -1)}
                              >
                                −
                              </button>
                              <span className="pos-option-stepper-count">{count}</span>
                              <button
                                type="button"
                                className="pos-option-stepper-btn"
                                aria-label={`เพิ่ม ${opt.name}`}
                                onClick={() => bumpChoice(group, opt.id, 1)}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="pos-option-choice-list">
                    {group.options.map((opt) => {
                      const selected = (gc[opt.id] || 0) > 0;
                      const price =
                        opt.priceDelta > 0 || (opt.priceDeltaMax != null && opt.priceDeltaMax > 0)
                          ? `+${formatPlainNumber(opt.priceDelta)}`
                          : "+0";
                      return (
                        <li key={opt.id}>
                          <button
                            type="button"
                            className={`pos-option-choice-btn ${selected ? "is-selected" : ""}`}
                            onClick={() => setSingleChoice(group, opt.id)}
                          >
                            <span className="pos-option-choice-control" aria-hidden>
                              {selected ? "●" : "○"}
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
