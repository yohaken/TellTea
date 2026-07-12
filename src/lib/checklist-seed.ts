import type { Employee } from "./employees";
import {
  CHECK_SHIFTS,
  listActiveChecklistItems,
  type CheckShiftId,
  type CheckStatus,
} from "./checklist";
import type { ParsedCheckSession } from "./checklist-import";
import { importChecklistSessions } from "./checklist-import";
import { parseDateInput, todayInputValue } from "./utils";

export type SeedChecklistOptions = {
  /** YYYY-MM-DD inclusive */
  startDate: string;
  /** YYYY-MM-DD inclusive — defaults to today */
  endDate?: string;
  createdBy: string;
  /** Skip date+shift if a session already exists */
  skipExisting?: boolean;
  /** 0–1 fail rate per item (default ~6%) */
  failRate?: number;
};

export type SeedChecklistResult = {
  sessions: number;
  records: number;
  skippedSessions: number;
  newEmployees: number;
  fromDate: string;
  toDate: string;
};

const DEMO_INSPECTORS = ["น้องมิ้นท์", "น้องบีม", "น้องแป้ง", "พี่โอ", "น้องเฟิร์น"];

function shiftHour(shift: CheckShiftId) {
  if (shift === "morning") return 8;
  if (shift === "evening") return 17;
  return 1;
}

/** Simple deterministic PRNG for reproducible demo rows. */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function eachLocalDay(startMs: number, endMs: number) {
  const days: number[] = [];
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function formatYmd(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const FAIL_REMARKS = [
  "ไม่ผ่าน — ต้องแก้ก่อนเปิดร้าน",
  "ของหมด / ยังไม่เติม",
  "แอพเปิดเมนูไม่ครบ",
  "อุณหภูมิไม่ถึง",
  "ต้องทำความสะอาดเพิ่ม",
];

export async function buildDemoCheckSessions(
  employees: Employee[],
  options: SeedChecklistOptions,
  existingSessions?: { date: number; shift: CheckShiftId }[],
): Promise<{ sessions: ParsedCheckSession[]; skippedSessions: number }> {
  const endDate = options.endDate || todayInputValue();
  const startMs = parseDateInput(options.startDate);
  const endMs = parseDateInput(endDate);
  if (startMs > endMs) throw new Error("วันเริ่มต้องไม่เกินวันสิ้นสุด");

  const catalog = await listActiveChecklistItems();
  if (!catalog.length) throw new Error("ยังไม่มีรายการตรวจ — ตั้งค่า SmartCheck ก่อน");

  const inspectors = employees.filter((e) => e.active).map((e) => e.name);
  const roster = inspectors.length ? inspectors : DEMO_INSPECTORS;

  const existingKey = new Set(
    (existingSessions || []).map((s) => `${s.date}:${s.shift}`),
  );

  const failRate = options.failRate ?? 0.06;
  const rand = mulberry32(startMs ^ endMs);
  const sessions: ParsedCheckSession[] = [];
  let skippedSessions = 0;
  let inspectorIdx = 0;
  let dayIdx = 0;

  for (const dateMs of eachLocalDay(startMs, endMs)) {
    for (const shift of CHECK_SHIFTS) {
      const key = `${dateMs}:${shift.id}`;
      if (options.skipExisting && existingKey.has(key)) {
        skippedSessions += 1;
        continue;
      }

      const inspector = roster[inspectorIdx % roster.length]!;
      inspectorIdx += 1;

      const items = catalog.map((item, itemIdx) => {
        const roll = rand();
        const status: CheckStatus = roll < failRate ? "fail" : "pass";
        const remark =
          status === "fail"
            ? FAIL_REMARKS[(dayIdx + itemIdx + inspectorIdx) % FAIL_REMARKS.length]!
            : "";
        return { itemName: item.name, status, remark };
      });

      sessions.push({
        date: dateMs,
        shift: shift.id,
        inspector,
        items,
        sourceRow: 0,
      });
    }
    dayIdx += 1;
  }

  return { sessions, skippedSessions };
}

export async function seedDemoChecklistRecords(
  employees: Employee[],
  options: SeedChecklistOptions,
  existingSessions?: { date: number; shift: CheckShiftId }[],
): Promise<SeedChecklistResult> {
  const endDate = options.endDate || todayInputValue();
  const { sessions, skippedSessions } = await buildDemoCheckSessions(
    employees,
    options,
    existingSessions,
  );

  if (!sessions.length) {
    return {
      sessions: 0,
      records: 0,
      skippedSessions,
      newEmployees: 0,
      fromDate: options.startDate,
      toDate: endDate,
    };
  }

  const imported = await importChecklistSessions(sessions, options.createdBy);
  return {
    sessions: imported.sessions,
    records: imported.records,
    skippedSessions,
    newEmployees: imported.newEmployees,
    fromDate: options.startDate,
    toDate: endDate,
  };
}

export function summarizeExistingSessions(
  records: { date: number; shift: CheckShiftId; checkId: string }[],
) {
  const seen = new Map<string, { date: number; shift: CheckShiftId }>();
  for (const row of records) {
    const key = `${row.date}:${row.shift}`;
    if (!seen.has(key)) {
      seen.set(key, { date: row.date, shift: row.shift });
    }
  }
  return [...seen.values()];
}

export { shiftHour, formatYmd as formatCheckSeedDate };
