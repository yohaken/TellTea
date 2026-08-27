import {
  OT_SHIFTS,
  computeOtBonus,
  labelOtShift,
  type OtEntry,
  type OtShiftId,
} from "./ot";
import { addLocalDays, isFutureBangkokDay, shiftSlotKey, startOfLocalDay } from "./utils";

/** ลำดับแสดงในตาราง — เย็น → เช้า → ดึก (ล่างสุด = ดึก · ไล่ขึ้น = ดึก→เช้า→เย็น) */
export const OT_SHIFT_DISPLAY_ORDER: OtShiftId[] = ["evening", "morning", "late"];

/** วางแผนล่วงหน้าได้กี่วัน (นับจากวันนี้) — รวมช่วงคาบเกี่ยวปลายเดือน */
export const OT_PLAN_AHEAD_DAYS = 2;

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

export function isFutureLocalDay(dateMs: number) {
  return isFutureBangkokDay(dateMs);
}

function indexEntriesBySlot(entries: OtEntry[]): Map<string, OtEntry> {
  const map = new Map<string, OtEntry>();
  for (const row of entries) {
    const key = shiftSlotKey(row.date, row.shift);
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
  return indexEntriesBySlot(entries).get(shiftSlotKey(dateMs, shift)) || null;
}

/** แตะวันที่ — แก้กะบนสุดที่มีข้อมูลก่อน (เย็น→เช้า→ดึก) หรือเปิดกะเช้า */
export function resolveDateTapTarget(group: OtDayGroup): OtSlotTarget {
  const tapOrder: OtShiftId[] = ["evening", "morning", "late"];
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
    cur = addLocalDays(cur, -1);
  }
  return days;
}

export type BuildOtGridOptions = {
  /** วันเริ่มต้นสุด (เก่าสุด) — default จากข้อมูลหรือวันนี้ */
  minDate?: number;
  /** วันสิ้นสุด (ใหม่สุด) — default วันนี้ */
  maxDate?: number;
  /**
   * true = ใช้เฉพาะ minDate..maxDate ไม่ขยายจาก entries / plan-ahead
   * (หน้าชงส่งช่วงจาก otViewWindow)
   */
  strictRange?: boolean;
};

/**
 * สร้างตารางวัน×กะ — ทุกวันมี 3 กะเสมอ (ว่างได้)
 * เรียงวันใหม่ → เก่า · เก็บข้ามเดือนได้
 */
export function buildOtGrid(entries: OtEntry[], options: BuildOtGridOptions = {}): OtDayGroup[] {
  const today = startOfLocalDay(Date.now());
  let oldest = options.minDate != null ? startOfLocalDay(options.minDate) : today;
  let newest = options.maxDate != null ? startOfLocalDay(options.maxDate) : today;

  if (!options.strictRange) {
    for (const row of entries) {
      const d = startOfLocalDay(row.date);
      if (d < oldest) oldest = d;
      if (d > newest) newest = d;
    }

    if (newest < today) newest = today;
    const planHorizon = addLocalDays(today, OT_PLAN_AHEAD_DAYS);
    if (newest < planHorizon) newest = planHorizon;
  }

  if (oldest > newest) oldest = newest;

  const slotMap = indexEntriesBySlot(entries);
  const groups: OtDayGroup[] = [];

  for (const dateMs of eachLocalDayDesc(newest, oldest)) {
    const slots: OtShiftSlot[] = OT_SHIFT_DISPLAY_ORDER.map((shiftId) => ({
      shiftId,
      shiftLabel: labelOtShift(shiftId),
      entry: slotMap.get(shiftSlotKey(dateMs, shiftId)) || null,
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
