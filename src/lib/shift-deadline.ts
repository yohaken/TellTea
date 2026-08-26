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

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

export type ShiftCountdownParts = {
  hours: number;
  minutes: number;
  seconds: number;
  millis: number;
};

export function splitShiftCountdown(ms: number): ShiftCountdownParts {
  if (ms <= 0) return { hours: 0, minutes: 0, seconds: 0, millis: 0 };
  const totalMs = Math.floor(ms);
  return {
    hours: Math.floor(totalMs / 3_600_000),
    minutes: Math.floor((totalMs % 3_600_000) / 60_000),
    seconds: Math.floor((totalMs % 60_000) / 1000),
    millis: totalMs % 1000,
  };
}

/** HH:MM:SS.mmm — ใช้ทั้ง hero และรายการ */
export function formatShiftCountdownPrecise(ms: number): string {
  if (ms <= 0) return "00:00:00.000";
  const { hours, minutes, seconds, millis } = splitShiftCountdown(ms);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

/** @deprecated ใช้ formatShiftCountdownPrecise */
export function formatShiftCountdownShort(ms: number): string {
  if (ms <= 0) return "เลย 24 ชม. แล้ว";
  return formatShiftCountdownPrecise(ms);
}

/** @deprecated ใช้ formatShiftCountdownPrecise */
export function formatShiftCountdownHero(ms: number): string {
  return formatShiftCountdownPrecise(ms);
}

/** ระดับความเร่งด่วน — ใช้ pulse UI */
export function shiftCountdownUrgency(ms: number): "calm" | "warn" | "critical" {
  if (ms <= 0) return "critical";
  if (ms < 600_000) return "critical";
  if (ms < 3_600_000) return "warn";
  return "calm";
}

export function fmtDeductPct(n: number) {
  return n % 1 === 0 ? `${n.toFixed(0)}%` : `${n.toFixed(1)}%`;
}
