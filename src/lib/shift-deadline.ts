import { checkShiftWindowMs } from "./check-shift-window";
import type { CheckShiftId } from "./checklist";
import type { PastIncompleteOtShift } from "./shift-session";
import { thaiMonthYearLabel } from "./bonus";

/** ชั่วโมงหลังจบกะที่ต้องใส่ครบ */
export const OT_INCOMPLETE_DEADLINE_HOURS = 24;

/** หักโบนัสต่อกะที่เลยกำหนด (สะสม) */
export const OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT = 0.3;

export function shiftCompletionDeadlineMs(dateMs: number, shift: CheckShiftId): number {
  const { endMs } = checkShiftWindowMs(dateMs, shift);
  return endMs + OT_INCOMPLETE_DEADLINE_HOURS * 3_600_000;
}

export function isShiftDeadlineOverdue(
  dateMs: number,
  shift: CheckShiftId,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= shiftCompletionDeadlineMs(dateMs, shift);
}

export function shiftCountdownMs(
  dateMs: number,
  shift: CheckShiftId,
  now: Date = new Date(),
): number {
  return Math.max(0, shiftCompletionDeadlineMs(dateMs, shift) - now.getTime());
}

/** เริ่มหักโบนัสจริง — วันแรกของเดือนถัดไป (เวลาไทย local) */
export function otIncompleteEnforcementMonth(now: Date = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function otIncompleteEnforcementLabel(now: Date = new Date()) {
  const { year, month } = otIncompleteEnforcementMonth(now);
  return thaiMonthYearLabel(year, month);
}

export function isOtIncompleteEnforcementActive(now: Date = new Date()): boolean {
  const { year, month } = otIncompleteEnforcementMonth(now);
  const enforceMs = new Date(year, month, 1).getTime();
  return now.getTime() >= enforceMs;
}

export function enrichPastIncompleteShift(
  item: PastIncompleteOtShift,
  now: Date = new Date(),
): PastIncompleteOtShift {
  const deadlineMs = shiftCompletionDeadlineMs(item.date, item.shift);
  const t = now.getTime();
  const overdue = t >= deadlineMs;
  const countdownMs = overdue ? 0 : deadlineMs - t;
  const previewDeductPct = overdue ? OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT : 0;
  return { ...item, deadlineMs, countdownMs, overdue, previewDeductPct };
}

export function sortPastIncompleteShifts(items: PastIncompleteOtShift[]): PastIncompleteOtShift[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? 1 : -1;
    if (!a.overdue && !b.overdue) return a.countdownMs - b.countdownMs;
    if (a.date !== b.date) return b.date - a.date;
    return a.shift.localeCompare(b.shift);
  });
}

export function sumIncompletePreviewDeductPct(items: PastIncompleteOtShift[]): number {
  const raw = items.reduce((s, i) => s + (i.overdue ? i.previewDeductPct : 0), 0);
  return Math.round(raw * 100) / 100;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** ข้อความนับถอยหลัง — สั้นสำหรับรายการ */
export function formatShiftCountdownShort(ms: number): string {
  if (ms <= 0) return "เลย 24 ชม. แล้ว";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h >= 1) return `อีก ${h} ชม. ${m} น.`;
  if (m >= 1) return `อีก ${m} น.`;
  return `อีก ${totalSec} วินาที`;
}

/** ตัวเลขใหญ่ HH:MM:SS สำหรับ hero */
export function formatShiftCountdownHero(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function fmtDeductPct(n: number) {
  return n % 1 === 0 ? `${n.toFixed(0)}%` : `${n.toFixed(1)}%`;
}
