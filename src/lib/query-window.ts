/**
 * ขอบเขตการโหลดข้อมูลบนเว็บ (อินเทอร์เน็ต) — ไม่ดึงประวัติทั้งก้อนเมื่อเข้าหน้า
 * คาตาล็อกเล็ก (พนักงาน/เมนู/เรท) ยังโหลดเต็มได้
 */

/** เริ่มต้นวันท้องถิ่น */
export function startOfLocalDayMs(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ย้อนหลัง N วัน (นับจากเที่ยงคืนวันนี้) */
export function daysAgoMs(days: number, now = Date.now()): number {
  const d = new Date(startOfLocalDayMs(now));
  d.setDate(d.getDate() - Math.max(1, Math.floor(days)));
  return d.getTime();
}

/**
 * ช่วงเดือนปฏิทินท้องถิ่น — until เป็น exclusive (วันแรกของเดือนถัดไป)
 * monthIdx = 0–11
 */
export function localMonthRangeMs(
  year: number,
  monthIdx: number,
): { since: number; until: number } {
  return {
    since: new Date(year, monthIdx, 1).getTime(),
    until: new Date(year, monthIdx + 1, 1).getTime(),
  };
}

/** ย้อนหลัง N เดือนปฏิทิน (วันแรกของเดือนนั้น) */
export function monthsAgoStartMs(months: number, now = Date.now()): number {
  const d = new Date(startOfLocalDayMs(now));
  d.setDate(1);
  d.setMonth(d.getMonth() - Math.max(1, Math.floor(months)));
  return d.getTime();
}

export type DateWindowOpts = {
  /** inclusive */
  since?: number;
  /** exclusive */
  until?: number;
};
