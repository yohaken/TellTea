import {
  CHECK_SHIFTS,
  groupRecordsBySession,
  type CheckShiftId,
  type ChecklistRecord,
  type CheckSessionSummary,
} from "./checklist";
import { OT_PLAN_AHEAD_DAYS } from "./ot-grid";

/** แสดงวันล่วงหน้าในตาราง — ให้สอดคล้องกับตารางชง */
export const CHECK_PLAN_AHEAD_DAYS = OT_PLAN_AHEAD_DAYS;

export const CHECK_SHIFT_SHORT: Record<CheckShiftId, string> = {
  late: "ดึก",
  morning: "เช้า",
  evening: "เย็น",
};

export type CheckHistoryShiftCell = {
  shiftId: CheckShiftId;
  label: string;
  shortLabel: string;
  session: CheckSessionSummary | null;
};

export type CheckHistoryDayRow = {
  dateMs: number;
  shifts: CheckHistoryShiftCell[];
  /** จำนวนรายการไม่ผ่านทั้งวัน */
  dayFails: number;
  /** จำนวนกะที่เช็คแล้ว (0–3) */
  dayFilled: number;
};

export type CheckHistoryMonthStats = {
  sessions: number;
  expectedSessions: number;
  failItems: number;
  daysWithIssues: number;
};

export function checkMonthInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function parseCheckMonthInput(value: string) {
  const [y, m] = value.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export function isCheckDateInMonth(ms: number, year: number, month: number) {
  const d = new Date(ms);
  return d.getFullYear() === year && d.getMonth() === month;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function latestSessionsByDateShift(
  records: ChecklistRecord[],
): Map<number, Map<CheckShiftId, CheckSessionSummary>> {
  const byDate = new Map<number, Map<CheckShiftId, CheckSessionSummary>>();
  for (const session of groupRecordsBySession(records)) {
    let dayMap = byDate.get(session.date);
    if (!dayMap) {
      dayMap = new Map();
      byDate.set(session.date, dayMap);
    }
    const existing = dayMap.get(session.shift);
    if (!existing || session.submittedAt > existing.submittedAt) {
      dayMap.set(session.shift, session);
    }
  }
  return byDate;
}

export function buildCheckHistoryGrid(
  records: ChecklistRecord[],
  year: number,
  month: number,
): CheckHistoryDayRow[] {
  const monthRecords = records.filter((r) => isCheckDateInMonth(r.date, year, month));
  const byDate = latestSessionsByDateShift(monthRecords);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDay = daysInMonth(year, month);
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const planLastDay = today.getDate() + CHECK_PLAN_AHEAD_DAYS;
  const maxDay = isCurrentMonth ? Math.min(lastDay, planLastDay) : lastDay;

  const rows: CheckHistoryDayRow[] = [];
  for (let day = maxDay; day >= 1; day -= 1) {
    const dateMs = new Date(year, month, day).getTime();
    const shiftMap = byDate.get(dateMs) || new Map();

    const shifts: CheckHistoryShiftCell[] = CHECK_SHIFTS.map((s) => ({
      shiftId: s.id,
      label: s.label,
      shortLabel: CHECK_SHIFT_SHORT[s.id],
      session: shiftMap.get(s.id) || null,
    }));

    const dayFails = shifts.reduce((sum, cell) => sum + (cell.session?.failed || 0), 0);
    const dayFilled = shifts.filter((cell) => cell.session).length;

    rows.push({ dateMs, shifts, dayFails, dayFilled });
  }

  return rows;
}

export function computeCheckHistoryMonthStats(rows: CheckHistoryDayRow[]): CheckHistoryMonthStats {
  let sessions = 0;
  let failItems = 0;
  let daysWithIssues = 0;

  for (const row of rows) {
    if (row.dayFails > 0) daysWithIssues += 1;
    for (const cell of row.shifts) {
      if (cell.session) {
        sessions += 1;
        failItems += cell.session.failed;
      }
    }
  }

  return {
    sessions,
    expectedSessions: rows.length * CHECK_SHIFTS.length,
    failItems,
    daysWithIssues,
  };
}

export function formatCheckTimeShort(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

export function inspectorShort(name: string) {
  const n = name.trim();
  if (n.length <= 8) return n;
  return n.slice(0, 7) + "…";
}
