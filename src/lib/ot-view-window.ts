/**
 * หน้าชง — ช่วงโหลด/แสดงตารางตามเดือนที่เลือก
 *
 * ค่าเริ่มต้น = เดือนปฏิทินปัจจุบัน + วันล่วงหน้า (ข้ามเดือนได้ช่วงคาบเกี่ยว)
 * เดือนอื่น (รวมเดือนที่ปิดบัญชี) โหลดเมื่อเลือกจาก combo เท่านั้น
 */
import { monthInputValue, parseMonthInput } from "./bonus";
import { OT_PLAN_AHEAD_DAYS } from "./ot-grid";

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

function startOfLocalDay(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addLocalDays(ms: number, days: number) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return startOfLocalDay(d.getTime());
}

/** ช่วงดูตารางชงจากค่าเดือน YYYY-MM */
export function otViewWindow(
  periodMonth: string,
  now = Date.now(),
): OtViewWindow {
  const { year, month } = parseMonthInput(periodMonth);
  const monthStart = new Date(year, month, 1).getTime();
  const nextMonthStart = new Date(year, month + 1, 1).getTime();
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
