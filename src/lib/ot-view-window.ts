/**
 * หน้าชง — ช่วงโหลด/แสดงตารางตามเดือนที่เลือก
 *
 * ค่าเริ่มต้น = เดือนปฏิทินปัจจุบัน + วันล่วงหน้า (ข้ามเดือนได้ช่วงคาบเกี่ยว)
 * เดือนอื่น (รวมเดือนที่ปิดบัญชี) โหลดเมื่อเลือกจาก combo เท่านั้น
 */
import { monthInputValue, parseMonthInput } from "./bonus";
import { OT_PLAN_AHEAD_DAYS } from "./ot-grid";
import { addLocalDays, startOfLocalDay } from "./utils";

export type OtViewWindow = {
  periodMonth: string;
  /** inclusive — ใช้ where date >= */
  since: number;
  /** exclusive — ใช้ where date < */
  until: number;
  gridMin: number;
  gridMax: number;
  /** เดือนปัจจุบัน: รวมวันล่วงหน้า (อาจล้นเข้าเดือนถัดไป) */
  isLive: boolean;
  planAheadDays: number;
};

function monthStartMs(periodMonth: string) {
  const { year, month } = parseMonthInput(periodMonth);
  const key = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return Date.parse(`${key}T00:00:00+07:00`);
}

function nextMonthStartMs(periodMonth: string) {
  const { year, month } = parseMonthInput(periodMonth);
  const nextMonth = month + 1;
  const nextYear = nextMonth > 11 ? year + 1 : year;
  const m = nextMonth > 11 ? 0 : nextMonth;
  const key = `${nextYear}-${String(m + 1).padStart(2, "0")}-01`;
  return Date.parse(`${key}T00:00:00+07:00`);
}

/** ช่วงดูตารางชงจากค่าเดือน YYYY-MM */
export function otViewWindow(
  periodMonth: string,
  now = Date.now(),
): OtViewWindow {
  const monthStart = monthStartMs(periodMonth);
  const nextMonthStart = nextMonthStartMs(periodMonth);
  const today = startOfLocalDay(now);
  const liveMonth = monthInputValue(new Date(now));
  const planAheadDays = OT_PLAN_AHEAD_DAYS;

  if (periodMonth === liveMonth) {
    const gridMax = addLocalDays(today, planAheadDays);
    return {
      periodMonth,
      since: monthStart,
      until: addLocalDays(gridMax, 1),
      gridMin: monthStart,
      gridMax,
      isLive: true,
      planAheadDays,
    };
  }

  return {
    periodMonth,
    since: monthStart,
    until: nextMonthStart,
    gridMin: monthStart,
    gridMax: addLocalDays(nextMonthStart, -1),
    isLive: false,
    planAheadDays,
  };
}
