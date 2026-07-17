import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { DEFAULT_OT_BONUS_RATE, getOtSettings, type OtEntry } from "./ot";
import {
  getRateSchedule,
  normalizeRateSchedule,
  rateScheduleDocForFirestore,
  resolveOtBonusRateForNewEntry,
  resolveRateForDate,
  type RateScheduleDoc,
  type RateScheduleEntry,
} from "./rate-schedule";
import { parseDateInput, todayInputValue } from "./utils";

/** Cutover when brew rate moved to 1 บาท — days before this use 0.6 */
export const OT_RATE_CUTOVER_INPUT = "2026-07-17";
export const OT_LEGACY_RATE = 0.6;
export const OT_NEW_RATE = 1;
export const OT_LEGACY_FROM_INPUT = "2020-01-01";

function scheduleRef() {
  return doc(getDb(), "meta", "rateSchedule");
}

function newEntryId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ratesClose(a: number, b: number) {
  return Math.abs(Number(a) - Number(b)) < 0.0005;
}

function dayBeforeLocal(ms: number): number {
  const d = new Date(Number(ms) || 0);
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * เรทชงที่ต้องติดบนแถว — ยึดวันในตารางกะจากตารางเรทเท่านั้น (ไม่ใช้ค่าที่ client ส่ง)
 */
export async function stampOtBonusRateForShiftDate(dateMs: number): Promise<number> {
  const [schedule, settings] = await Promise.all([getRateSchedule(), getOtSettings()]);
  return resolveOtBonusRateForNewEntry(
    dateMs,
    schedule.entries,
    settings.bonusRate || DEFAULT_OT_BONUS_RATE,
  );
}

/**
 * บังคับประวัติเรทชง: 0.6 ก่อน cutover · เรทใหม่ตั้งแต่ cutover
 * ลบแถว OT ในตารางเรทที่ effective ก่อน cutover แต่เรทไม่ใช่ 0.6 (กันย้อนหลังไปโดน 1 บาท)
 */
export async function ensureOtRateScheduleHistory(opts?: {
  cutoverInput?: string;
  legacyRate?: number;
  newRate?: number;
  createdBy?: string;
}): Promise<RateScheduleDoc> {
  const cutoverInput = opts?.cutoverInput || OT_RATE_CUTOVER_INPUT;
  const legacyRate = opts?.legacyRate ?? OT_LEGACY_RATE;
  const createdBy = opts?.createdBy || "system-repair";
  const cutoverMs = parseDateInput(cutoverInput);
  const legacyFrom = parseDateInput(OT_LEGACY_FROM_INPUT);
  const dayBefore = dayBeforeLocal(cutoverMs);

  const current = await getRateSchedule();
  const newRate = opts?.newRate ?? OT_NEW_RATE;

  const entries = current.entries.filter((e) => {
    if (e.kind !== "ot") return true;
    if (e.effectiveFrom >= cutoverMs) return true;
    return ratesClose(e.rate, legacyRate);
  });

  const extras: RateScheduleEntry[] = [];
  const beforeHit = resolveRateForDate(entries, "ot", dayBefore);
  if (!beforeHit || !ratesClose(beforeHit.rate, legacyRate)) {
    extras.push({
      id: newEntryId(),
      kind: "ot",
      effectiveFrom: legacyFrom,
      rate: legacyRate,
      note: "เรทเดิม 0.6 (ก่อนปรับ 17 ก.ค.)",
      createdAt: Date.now(),
      createdBy,
    });
  }

  const onCutover = resolveRateForDate([...entries, ...extras], "ot", cutoverMs);
  if (!onCutover || !ratesClose(onCutover.rate, newRate)) {
    extras.push({
      id: newEntryId(),
      kind: "ot",
      effectiveFrom: cutoverMs,
      rate: newRate,
      note: "เรทใหม่ตั้งแต่ 17 ก.ค.",
      createdAt: Date.now() + 1,
      createdBy,
    });
  }

  const next: RateScheduleDoc = {
    entries: normalizeRateSchedule({
      entries: [...entries, ...extras],
      updatedAt: Date.now(),
    }).entries,
    updatedAt: Date.now(),
  };
  await setDoc(scheduleRef(), rateScheduleDocForFirestore(next), { merge: false });

  // Keep settings in sync with today's schedule rate
  const todayMs = parseDateInput(todayInputValue());
  const active = resolveRateForDate(next.entries, "ot", todayMs);
  if (active) {
    const { saveOtSettings } = await import("./ot");
    await saveOtSettings(active.rate);
  }

  return next;
}

export type OtRateRepairReport = {
  scheduleUpdated: boolean;
  scanned: number;
  updated: number;
  sample: Array<{ id: string; date: number; from: number; to: number }>;
};

/**
 * ซ่อม bonusRate บน otEntries ทั้งร้านให้ตรงตารางเรทตามวันของแถว
 */
export async function repairOtBonusRatesFromSchedule(opts?: {
  cutoverInput?: string;
  legacyRate?: number;
  newRate?: number;
  createdBy?: string;
}): Promise<OtRateRepairReport> {
  await ensureOtRateScheduleHistory(opts);
  const schedule = await getRateSchedule();
  const settings = await getOtSettings();
  const fallback = settings.bonusRate || DEFAULT_OT_BONUS_RATE;

  const snap = await getDocs(collection(getDb(), "otEntries"));
  const now = Date.now();
  let updated = 0;
  const sample: OtRateRepairReport["sample"] = [];
  let batch = writeBatch(getDb());
  let ops = 0;

  async function flush() {
    if (!ops) return;
    await batch.commit();
    batch = writeBatch(getDb());
    ops = 0;
  }

  for (const d of snap.docs) {
    const data = d.data() as Partial<OtEntry>;
    const dateMs = Number(data.date) || 0;
    const currentRate = Number(data.bonusRate) || 0;
    const correct = resolveOtBonusRateForNewEntry(dateMs, schedule.entries, fallback);
    if (ratesClose(currentRate, correct)) continue;
    batch.update(doc(getDb(), "otEntries", d.id), {
      bonusRate: correct,
      updatedAt: now,
    });
    ops += 1;
    updated += 1;
    if (sample.length < 12) {
      sample.push({ id: d.id, date: dateMs, from: currentRate, to: correct });
    }
    if (ops >= 400) await flush();
  }
  await flush();

  return {
    scheduleUpdated: true,
    scanned: snap.size,
    updated,
    sample,
  };
}
