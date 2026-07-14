import {
  OT_SHIFTS,
  computeOtBonus,
  labelOtShift,
  type OtEntry,
  type OtShiftId,
} from "./ot";

/** ลำดับแสดงในตาราง — เช้า → เย็น → ดึก (กะงานต่อเนื่อง) */
export const OT_SHIFT_DISPLAY_ORDER: OtShiftId[] = ["morning", "evening", "late"];

/** วางแผนล่วงหน้าได้กี่วัน (นับจากวันนี้) */
export const OT_PLAN_AHEAD_DAYS = 3;

export type OtShiftSlot = {
  shiftId: OtShiftId;
  shiftLabel: string;
  entry: OtEntry | null;
};

export type OtDayGroup = {
  date: number;
  slots: OtShiftSlot[];
  shiftCount: number;
  filledCount: number;
  summaryQty: number;
  totalBonus: number;
};

export type OtSlotTarget = {
  date: number;
  shift: OtShiftId;
  entry: OtEntry | null;
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

export function isFutureLocalDay(dateMs: number) {
  return startOfLocalDay(dateMs) > startOfLocalDay(Date.now());
}

export function localDayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function indexEntriesBySlot(entries: OtEntry[]): Map<string, OtEntry> {
  const map = new Map<string, OtEntry>();
  for (const row of entries) {
    const key = `${localDayKey(row.date)}|${row.shift}`;
    const prev = map.get(key);
    if (!prev || row.createdAt > prev.createdAt) map.set(key, row);
  }
  return map;
}

/** รายการล่าสุดต่อช่อง วัน×กะ */
export function findOtEntryForSlot(
  entries: OtEntry[],
  dateMs: number,
  shift: OtShiftId,
): OtEntry | null {
  return indexEntriesBySlot(entries).get(`${localDayKey(dateMs)}|${shift}`) || null;
}

/** แตะวันที่ — แก้กะล่าสุดของวัน (ดึก→เย็น→เช้า) หรือเปิดเพิ่มกะเช้า */
export function resolveDateTapTarget(group: OtDayGroup): OtSlotTarget {
  const tapOrder: OtShiftId[] = ["late", "evening", "morning"];
  for (const shiftId of tapOrder) {
    const slot = group.slots.find((s) => s.shiftId === shiftId);
    if (slot?.entry) {
      return { date: group.date, shift: shiftId, entry: slot.entry };
    }
  }
  return { date: group.date, shift: "morning", entry: null };
}

function eachLocalDayDesc(newestMs: number, oldestMs: number): number[] {
  const days: number[] = [];
  let cur = startOfLocalDay(newestMs);
  const end = startOfLocalDay(oldestMs);
  while (cur >= end) {
    days.push(cur);
    const prev = new Date(cur);
    prev.setDate(prev.getDate() - 1);
    cur = startOfLocalDay(prev.getTime());
  }
  return days;
}

export type BuildOtGridOptions = {
  /** วันเริ่มต้นสุด (เก่าสุด) — default จากข้อมูลหรือวันนี้ */
  minDate?: number;
  /** วันสิ้นสุด (ใหม่สุด) — default วันนี้ */
  maxDate?: number;
};

/**
 * สร้างตารางวัน×กะ — ทุกวันมี 3 กะเสมอ (ว่างได้)
 * เรียงวันใหม่ → เก่า · เก็บข้ามเดือนได้
 */
export function buildOtGrid(entries: OtEntry[], options: BuildOtGridOptions = {}): OtDayGroup[] {
  const today = startOfLocalDay(Date.now());
  let oldest = options.minDate != null ? startOfLocalDay(options.minDate) : today;
  let newest = options.maxDate != null ? startOfLocalDay(options.maxDate) : today;

  for (const row of entries) {
    const d = startOfLocalDay(row.date);
    if (d < oldest) oldest = d;
    if (d > newest) newest = d;
  }

  if (newest < today) newest = today;
  const planHorizon = addLocalDays(today, OT_PLAN_AHEAD_DAYS);
  if (newest < planHorizon) newest = planHorizon;
  if (oldest > newest) oldest = newest;

  const slotMap = indexEntriesBySlot(entries);
  const groups: OtDayGroup[] = [];

  for (const dateMs of eachLocalDayDesc(newest, oldest)) {
    const slots: OtShiftSlot[] = OT_SHIFT_DISPLAY_ORDER.map((shiftId) => ({
      shiftId,
      shiftLabel: labelOtShift(shiftId),
      entry: slotMap.get(`${localDayKey(dateMs)}|${shiftId}`) || null,
    }));

    let shiftCount = 0;
    let summaryQty = 0;
    let totalBonus = 0;
    let filledCount = 0;

    for (const slot of slots) {
      if (!slot.entry) continue;
      filledCount += 1;
      shiftCount += 1;
      const c = computeOtBonus(slot.entry);
      summaryQty += c.summaryQty;
      totalBonus += c.totalBonus;
    }

    groups.push({
      date: dateMs,
      slots,
      shiftCount,
      filledCount,
      summaryQty,
      totalBonus,
    });
  }

  return groups;
}

export function otShiftLabels() {
  return OT_SHIFTS.map((s) => ({ id: s.id, label: s.label }));
}
