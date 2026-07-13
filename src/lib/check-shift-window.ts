import { labelCheckShift, type CheckShiftId } from "./checklist";
import { formatDateShort, startOfLocalDay } from "./utils";

/** สอดคล้องกับ shift-session getCurrentShiftId — 0.3 = 18 นาทีหลังเที่ยงคืน */
const LATE_START_MINS = 18;
const MORNING_START_MINS = 7 * 60;
const EVENING_START_MINS = 17 * 60;

function minsToMs(dayMs: number, mins: number) {
  return dayMs + mins * 60 * 1000;
}

/** ช่วงเวลากะต่อวัน×กะ (ครึ่งเปิด [start, end)) — ใช้กำหนดจังหวะกะ */
export function checkShiftWindowMs(dateMs: number, shift: CheckShiftId) {
  const dayMs = startOfLocalDay(new Date(dateMs));
  const nextDayMs = dayMs + 86_400_000;

  switch (shift) {
    case "late":
      return {
        startMs: minsToMs(dayMs, LATE_START_MINS),
        endMs: minsToMs(dayMs, MORNING_START_MINS),
      };
    case "morning":
      return {
        startMs: minsToMs(dayMs, MORNING_START_MINS),
        endMs: minsToMs(dayMs, EVENING_START_MINS),
      };
    case "evening":
      return {
        startMs: minsToMs(dayMs, EVENING_START_MINS),
        endMs: minsToMs(nextDayMs, LATE_START_MINS),
      };
  }
}

/** อยู่ในช่วงเวลากะ ณ ขณะนี้ (ใช้เลือกกะปัจจุบันสำหรับปุ่ม + กรอก) */
export function isWithinCheckShiftWindow(
  dateMs: number,
  shift: CheckShiftId,
  now: Date = new Date(),
): boolean {
  const { startMs, endMs } = checkShiftWindowMs(dateMs, shift);
  const t = now.getTime();
  return t >= startMs && t < endMs;
}

/**
 * เริ่มเช็คได้หรือยัง — ห้ามเฉพาะล่วงหน้า (ก่อนเวลาเริ่มกะ)
 * เช็คย้อนหลังได้เสมอหลังกะเริ่มแล้ว
 */
export function canStartCheck(
  dateMs: number,
  shift: CheckShiftId,
  now: Date = new Date(),
): boolean {
  const { startMs } = checkShiftWindowMs(dateMs, shift);
  return now.getTime() >= startMs;
}

/** @deprecated ใช้ canStartCheck หรือ isWithinCheckShiftWindow แทน */
export function isCheckShiftOpen(
  dateMs: number,
  shift: CheckShiftId,
  now: Date = new Date(),
): boolean {
  return canStartCheck(dateMs, shift, now);
}

/** กะที่กำลังอยู่ในเวลาเช็ค ณ ขณะนี้ */
export function getActiveCheckSlot(now: Date = new Date()): {
  dateMs: number;
  shift: CheckShiftId;
} {
  const dayMs = startOfLocalDay(now);
  const mins = now.getHours() * 60 + now.getMinutes();

  if (mins >= LATE_START_MINS && mins < MORNING_START_MINS) {
    return { dateMs: dayMs, shift: "late" };
  }
  if (mins >= MORNING_START_MINS && mins < EVENING_START_MINS) {
    return { dateMs: dayMs, shift: "morning" };
  }
  if (mins >= EVENING_START_MINS) {
    return { dateMs: dayMs, shift: "evening" };
  }
  const prev = new Date(dayMs);
  prev.setDate(prev.getDate() - 1);
  return { dateMs: startOfLocalDay(prev), shift: "evening" };
}

function formatWindowTime(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

/** ข้อความเมื่อเช็คล่วงหน้าไม่ได้ — ว่างถ้าเริ่มเช็คได้แล้ว */
export function checkShiftWindowMessage(
  dateMs: number,
  shift: CheckShiftId,
  now: Date = new Date(),
): string {
  if (canStartCheck(dateMs, shift, now)) return "";
  const { startMs } = checkShiftWindowMs(dateMs, shift);
  const label = labelCheckShift(shift);
  const dateLabel = formatDateShort(dateMs);
  return `${dateLabel} · ${label} — ยังไม่ถึงเวลาเช็ค (เปิด ${formatWindowTime(startMs)})`;
}
