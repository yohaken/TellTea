"use client";

import type { ShiftProgress } from "@/lib/shift-session";

const STEPS = [
  { key: "workersSet", label: "พนักงาน" },
  { key: "openSopComplete", label: "เช็คเปิดกะ" },
  { key: "closeSopComplete", label: "เช็คปิดกะ" },
  { key: "otComplete", label: "ยอดชง" },
] as const;

export function ShiftProgressSteps({
  progress,
  compact,
}: {
  progress: ShiftProgress;
  compact?: boolean;
}) {
  return (
    <div className={`shift-progress${compact ? " is-compact" : ""}`}>
      <div className="shift-progress-head">
        <span className="shift-progress-title">
          ความคืบหน้า {progress.completedCount}/{progress.totalSteps}
        </span>
        {progress.missingLabels.length ? (
          <span className="shift-progress-missing muted">
            เหลือ: {progress.missingLabels.join(" · ")}
          </span>
        ) : (
          <span className="shift-progress-done">ครบแล้ว</span>
        )}
      </div>
      <div className="shift-progress-steps" role="list">
        {STEPS.map((step) => {
          const done = progress[step.key];
          return (
            <div
              key={step.key}
              role="listitem"
              className={`shift-progress-step${done ? " is-done" : " is-pending"}`}
            >
              <span className="shift-progress-dot" aria-hidden>
                {done ? "✓" : "○"}
              </span>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ShiftTodayBanner({
  shiftLabel,
  progress,
  onOpen,
}: {
  shiftLabel: string;
  progress: ShiftProgress;
  onOpen: () => void;
}) {
  if (progress.status === "complete") {
    return (
      <div className="shift-today-banner is-complete">
        <strong>{shiftLabel}</strong>
        <span>ปิดกะครบแล้ว ✓</span>
      </div>
    );
  }

  return (
    <div className="shift-today-banner is-pending">
      <div>
        <strong>{shiftLabel}</strong>
        <span className="muted">
          {progress.status === "empty"
            ? "ยังไม่ปิดกะ"
            : progress.status === "planned"
              ? "วางแผนแล้ว — รอปิดกะ"
              : `ค้าง ${progress.missingLabels.join(" · ")}`}
        </span>
      </div>
      <button type="button" className="primary-btn shift-today-btn" onClick={onOpen}>
        {progress.status === "empty" ? "ปิดกะ" : `ปิดกะ — เหลือ ${progress.missingLabels.length}`}
      </button>
    </div>
  );
}

export function ShiftOwnerFlags({ hints }: { hints: string[] }) {
  if (!hints.length) return null;
  return (
    <div className="shift-owner-flags" aria-label="สัญญาณคุณภาพ (เจ้าของ)">
      {hints.map((hint) => (
        <span key={hint} className="shift-owner-flag">
          ⚠ {hint}
        </span>
      ))}
    </div>
  );
}
