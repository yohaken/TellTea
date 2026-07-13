"use client";

import type { ChecklistItem } from "@/lib/checklist";
import type { CheckStatus } from "@/lib/checklist";

export type SopDraftStatus = CheckStatus | "pending";

export type SopDraftItem = {
  itemId: string;
  itemName: string;
  status: SopDraftStatus;
  remark: string;
};

export function buildSopDrafts(items: ChecklistItem[]): SopDraftItem[] {
  return items.map((item) => ({
    itemId: item.id,
    itemName: item.name,
    status: "pending",
    remark: "",
  }));
}

export function sopDraftsComplete(drafts: SopDraftItem[]) {
  return drafts.length > 0 && drafts.every((d) => d.status !== "pending");
}

export function ShiftSopSection({
  title,
  hint,
  drafts,
  disabled,
  onChange,
  onError,
}: {
  title: string;
  hint: string;
  drafts: SopDraftItem[];
  disabled?: boolean;
  onChange: (next: SopDraftItem[]) => void;
  onError: (msg: string) => void;
}) {
  if (!drafts.length) return null;

  const pending = drafts.filter((d) => d.status === "pending").length;

  function setStatus(index: number, status: CheckStatus) {
    if (disabled) return;
    onChange(
      drafts.map((d, i) =>
        i === index
          ? {
              ...d,
              status,
              remark: status === "pass" ? "" : d.remark,
            }
          : d,
      ),
    );
  }

  function setRemark(index: number, remark: string) {
    onChange(drafts.map((d, i) => (i === index ? { ...d, remark } : d)));
  }

  return (
    <section className="shift-sop-section">
      <div className="shift-sop-head">
        <h3 className="shift-sop-title">{title}</h3>
        <span className="shift-sop-meta muted">
          {pending ? `เหลือ ${pending} ข้อ` : "ครบแล้ว"} · {hint}
        </span>
      </div>
      <ul className="shift-sop-list">
        {drafts.map((draft, index) => (
          <li
            key={draft.itemId}
            className={`shift-sop-row${draft.status === "pending" ? " is-pending" : ""}`}
          >
            <span className="shift-sop-name">{draft.itemName}</span>
            <div className="shift-sop-actions">
              <button
                type="button"
                className={draft.status === "pass" ? "suggest-chip is-active" : "suggest-chip"}
                disabled={disabled}
                onClick={() => setStatus(index, "pass")}
              >
                ผ่าน
              </button>
              <button
                type="button"
                className={
                  draft.status === "fail" ? "suggest-chip is-active is-fail" : "suggest-chip"
                }
                disabled={disabled}
                onClick={() => {
                  if (draft.status !== "fail") setStatus(index, "fail");
                }}
              >
                ไม่ผ่าน
              </button>
            </div>
            {draft.status === "fail" ? (
              <input
                className="shift-sop-remark"
                value={draft.remark}
                disabled={disabled}
                placeholder="ระบุปัญหา"
                onChange={(e) => setRemark(index, e.target.value)}
                onBlur={() => {
                  if (!draft.remark.trim()) {
                    onError(`รายการ "${draft.itemName}" ไม่ผ่าน — ต้องระบุหมายเหตุ`);
                  }
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function validateSopDrafts(drafts: SopDraftItem[], sectionLabel: string) {
  const pending = drafts.filter((d) => d.status === "pending").length;
  if (pending > 0) {
    return `${sectionLabel} — ยังไม่ได้ตรวจ ${pending} ข้อ`;
  }
  for (const d of drafts) {
    if (d.status === "fail" && !d.remark.trim()) {
      return `${sectionLabel} — "${d.itemName}" ต้องระบุหมายเหตุ`;
    }
  }
  return null;
}
