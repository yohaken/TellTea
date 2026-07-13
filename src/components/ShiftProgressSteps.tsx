"use client";

/**
 * UI หน้าปิดกะ / SOP — หลักการแสดงผล (อ้างอิงเวลาแก้ layout)
 * - อ่านได้ใน 1–2 วินาที ข้อความสั้น ไม่ลิสต์ยาว
 * - เรียบง่าย ไม่การ์ดใหญ่ ไม่ซ้อนปุ่มกับข้อความ
 * - มือถือก่อน: เรียงแนวตั้ง ปุ่มเต็มความกว้างด้านล่าง
 * - รายละเอียดเต็มอยู่ในฟอร์มปิดกะ ไม่ยัดในหน้าตาราง
 */

import type { ShiftProgress } from "@/lib/shift-session";
import {
  shiftBannerStatusShort,
  shiftCloseButtonLabel,
} from "@/lib/shift-session";

const STEPS = [
  { key: "workersSet", label: "พนักงาน" },
  { key: "openSopComplete", label: "เปิดกะ" },
  { key: "closeSopComplete", label: "ปิดกะ" },
  { key: "otComplete", label: "ยอด" },
] as const;

export function ShiftProgressSteps({
  progress,
  compact,
}: {
  progress: ShiftProgress;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="shift-progress is-compact" aria-label="ความคืบหน้าปิดกะ">
        <div className="shift-progress-chips" role="list">
          {STEPS.map((step) => {
            const done = progress[step.key];
            return (
              <span
                key={step.key}
                role="listitem"
                className={`shift-chip${done ? " is-done" : ""}`}
              >
                {done ? "✓" : "○"} {step.label}
              </span>
            );
          })}
        </div>
        {progress.missingLabels.length ? (
          <p className="shift-progress-hint muted">เหลือ {progress.missingLabels.length} ข้อ</p>
        ) : (
          <p className="shift-progress-hint is-done">ครบแล้ว</p>
        )}
      </div>
    );
  }

  return (
    <div className="shift-progress">
      <p className="shift-progress-title">
        ความคืบหน้า {progress.completedCount}/{progress.totalSteps}
        {progress.missingLabels.length ? (
          <span className="muted"> · เหลือ {progress.missingLabels.length} ข้อ</span>
        ) : null}
      </p>
      <div className="shift-progress-chips" role="list">
        {STEPS.map((step) => {
          const done = progress[step.key];
          return (
            <span
              key={step.key}
              role="listitem"
              className={`shift-chip${done ? " is-done" : ""}`}
            >
              {done ? "✓" : "○"} {step.label}
            </span>
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
  const done = progress.status === "complete";

  return (
    <div className={`shift-today-strip${done ? " is-complete" : ""}`}>
      <div className="shift-today-text">
        <span className="shift-today-title">
          {shiftLabel}
          <span className="shift-today-sub">วันนี้</span>
        </span>
        <span className={`shift-today-status${done ? " is-done" : ""}`}>
          {shiftBannerStatusShort(progress)}
        </span>
      </div>
      <button type="button" className="shift-today-action" onClick={onOpen}>
        {shiftCloseButtonLabel(progress)}
      </button>
    </div>
  );
}

export function ShiftOwnerFlags({ hints }: { hints: string[] }) {
  if (!hints.length) return null;
  return (
    <p className="shift-owner-line muted" aria-label="สัญญาณคุณภาพ (เจ้าของ)">
      เจ้าของ: {hints.join(" · ")}
    </p>
  );
}
