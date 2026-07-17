import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { DEFAULT_OT_BONUS_RATE, getOtSettings, saveOtSettings } from "./ot";
import { parseDateInput, todayInputValue } from "./utils";

/** ชนิดเรทที่กำหนดเป็นช่วงเวลาได้ */
export type RateKind = "ot" | "bakerySales";

export const RATE_KIND_LABELS: Record<RateKind, string> = {
  ot: "เรทชง (บาท/หน่วย)",
  bakerySales: "เรทขายเบเกอรี่ (บาท/หน่วย)",
};

export type RateScheduleEntry = {
  id: string;
  kind: RateKind;
  /** วันเริ่มใช้ (local midnight ms) — ใช้เรื่อยๆ จนมีแถวใหม่ของชนิดเดียวกัน */
  effectiveFrom: number;
  /** ค่าเรท — ทศนิยมละเอียดได้ */
  rate: number;
  note?: string;
  createdAt: number;
  createdBy: string;
};

export type RateScheduleDoc = {
  entries: RateScheduleEntry[];
  updatedAt: number;
};

function scheduleRef() {
  return doc(getDb(), "meta", "rateSchedule");
}

function newEntryId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeRateSchedule(
  data: Partial<RateScheduleDoc> | undefined,
): RateScheduleDoc {
  const raw = Array.isArray(data?.entries) ? data!.entries! : [];
  const entries: RateScheduleEntry[] = [];
  for (const row of raw) {
    if (!row || (row.kind !== "ot" && row.kind !== "bakerySales")) continue;
    const effectiveFrom = Number(row.effectiveFrom);
    const rate = Number(row.rate);
    if (!Number.isFinite(effectiveFrom) || !Number.isFinite(rate)) continue;
    entries.push({
      id: String(row.id || newEntryId()),
      kind: row.kind,
      effectiveFrom,
      rate,
      note: row.note ? String(row.note).slice(0, 200) : undefined,
      createdAt: Number(row.createdAt) || 0,
      createdBy: String(row.createdBy || ""),
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return b.effectiveFrom - a.effectiveFrom || b.createdAt - a.createdAt;
  });
  return {
    entries,
    updatedAt: Number(data?.updatedAt) || 0,
  };
}

/**
 * เรทที่ใช้ ณ วันที่ — เลือกแถวล่าสุดที่ effectiveFrom ≤ dateMs
 * ไม่มีในตาราง → null (ให้ caller ใช้ fallback ของระบบเดิม)
 */
export function resolveRateForDate(
  entries: RateScheduleEntry[],
  kind: RateKind,
  dateMs: number,
): RateScheduleEntry | null {
  const day = Number(dateMs) || 0;
  let best: RateScheduleEntry | null = null;
  for (const row of entries) {
    if (row.kind !== kind) continue;
    if (row.effectiveFrom > day) continue;
    if (
      !best ||
      row.effectiveFrom > best.effectiveFrom ||
      (row.effectiveFrom === best.effectiveFrom && row.createdAt > best.createdAt)
    ) {
      best = row;
    }
  }
  return best;
}

export function listRateHistory(
  entries: RateScheduleEntry[],
  kind?: RateKind,
): RateScheduleEntry[] {
  const rows = kind ? entries.filter((e) => e.kind === kind) : [...entries];
  return rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return b.effectiveFrom - a.effectiveFrom || b.createdAt - a.createdAt;
  });
}

export async function getRateSchedule(): Promise<RateScheduleDoc> {
  const snap = await getDoc(scheduleRef());
  if (!snap.exists()) return { entries: [], updatedAt: 0 };
  return normalizeRateSchedule(snap.data() as Partial<RateScheduleDoc>);
}

export function subscribeRateSchedule(
  onDoc: (doc: RateScheduleDoc) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    scheduleRef(),
    (snap) => {
      if (!snap.exists()) {
        onDoc({ entries: [], updatedAt: 0 });
        return;
      }
      onDoc(normalizeRateSchedule(snap.data() as Partial<RateScheduleDoc>));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export type RateScheduleAddInput = {
  kind: RateKind;
  /** YYYY-MM-DD หรือค่าที่ parseDateInput รับได้ */
  effectiveFromInput: string;
  rate: number;
  note?: string;
  createdBy: string;
};

/**
 * เพิ่มช่วงเรทใหม่ — ไม่แก้แถวชง/ผลิตที่มีอยู่แล้ว
 * ถ้า kind=ot และวันเริ่ม ≤ วันนี้ → sync meta/otSettings ให้หน้าตั้งค่าเดิมตรงกับเรทปัจจุบัน
 */
export async function addRateScheduleEntry(input: RateScheduleAddInput): Promise<RateScheduleDoc> {
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error("ใส่เรทให้ถูกต้อง (ตัวเลข ≥ 0)");
  }
  const effectiveFrom = parseDateInput(input.effectiveFromInput);
  if (!effectiveFrom) throw new Error("ใส่วันที่เริ่มใช้เรท");

  const current = await getRateSchedule();
  const nextEntry: RateScheduleEntry = {
    id: newEntryId(),
    kind: input.kind,
    effectiveFrom,
    rate,
    note: input.note?.trim() || undefined,
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };
  const next: RateScheduleDoc = {
    entries: normalizeRateSchedule({
      entries: [...current.entries, nextEntry],
      updatedAt: Date.now(),
    }).entries,
    updatedAt: Date.now(),
  };

  await setDoc(scheduleRef(), next, { merge: false });

  if (input.kind === "ot") {
    const todayMs = parseDateInput(todayInputValue());
    const active = resolveRateForDate(next.entries, "ot", todayMs);
    if (active) {
      await saveOtSettings(active.rate);
    }
  }

  return next;
}

export async function deleteRateScheduleEntry(entryId: string): Promise<RateScheduleDoc> {
  const current = await getRateSchedule();
  const nextEntries = current.entries.filter((e) => e.id !== entryId);
  if (nextEntries.length === current.entries.length) {
    throw new Error("ไม่พบช่วงเรทนี้");
  }
  const next: RateScheduleDoc = {
    entries: nextEntries,
    updatedAt: Date.now(),
  };
  await setDoc(scheduleRef(), next, { merge: false });

  const todayMs = parseDateInput(todayInputValue());
  const activeOt = resolveRateForDate(next.entries, "ot", todayMs);
  if (activeOt) {
    await saveOtSettings(activeOt.rate);
  } else {
    const settings = await getOtSettings();
    await saveOtSettings(settings.bonusRate || DEFAULT_OT_BONUS_RATE);
  }

  return normalizeRateSchedule(next);
}

/**
 * เรทชงสำหรับรายการใหม่ ณ วันที่ — จากตารางช่วงเวลา แล้วค่อย fallback ตั้งค่าเดิม
 * รายการเก่าต้องใช้ entry.bonusRate ที่ติดแถวอยู่แล้วเท่านั้น
 */
export function resolveOtBonusRateForNewEntry(
  dateMs: number,
  schedule: RateScheduleEntry[],
  settingsFallback: number,
): number {
  const hit = resolveRateForDate(schedule, "ot", dateMs);
  if (hit) return hit.rate;
  const fb = Number(settingsFallback);
  return Number.isFinite(fb) && fb >= 0 ? fb : DEFAULT_OT_BONUS_RATE;
}

/**
 * เรทขายเบเกอรี่สำหรับรายการผลิตใหม่ — มีในตารางใช้ตามวัน ไม่มีใช้เรทสินค้า
 * รายการเก่าต้องใช้ entry.salesRate ที่ติดแถวอยู่แล้วเท่านั้น
 */
export function resolveBakerySalesRateForNewEntry(
  dateMs: number,
  schedule: RateScheduleEntry[],
  productSalesRate: number,
): number {
  const hit = resolveRateForDate(schedule, "bakerySales", dateMs);
  if (hit) return hit.rate;
  return Number(productSalesRate) || 0;
}
