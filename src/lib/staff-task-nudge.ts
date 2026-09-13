/**
 * แจ้งเตือนงาน (soft) — มุมพนักงานรายคน
 * รับทราบ = ปิดแค่วันนี้ (Asia/Bangkok) · ไม่ใช่ส่งงาน · พรุ่งนี้ขึ้นใหม่
 * คลาวด์: notifyAcks[employeeId] = { dayKey, at, name } บน taskOccurrences
 */
import {
  isNotifyOnlyNudge,
  normalizeTaskNudgeKind,
  type TaskNudgeKind,
  type TaskOccurrence,
} from "./task-types";
import { bangkokDateKey } from "./utils";

export type StaffTaskNudgeItem = {
  id: string;
  title: string;
  note: string;
  dueDate: number;
  nudgeKind: TaskNudgeKind;
  periodKey: string;
};

/** งานส่งที่เปิดแล้ว — ต้องไปส่ง ไม่ใช่รับทราบ */
export type StaffWorkNudgeItem = {
  id: string;
  title: string;
  note: string;
  dueDate: number;
  status: "pending" | "waiting" | "missed";
  /** overdue = พลาด/เลยกำหนด · dueSoon = ใน 2 วัน · open = เปิดแล้ว */
  urgency: "overdue" | "dueSoon" | "open";
};

export type OwnerNotifyAckSummary = {
  assigneeCount: number;
  ackedTodayCount: number;
  pendingTodayCount: number;
  ackedTodayNames: string[];
  pendingTodayNames: string[];
  /** รายคน — สำหรับชิปสถานะบนตารางเจ้าของ */
  people: OwnerNotifyPersonStatus[];
  /** รับทราบล่าสุดของใครก็ได้ในรอบนี้ (พอสำหรับเจ้าของ) */
  lastAck: {
    employeeId: string;
    name: string;
    at: number;
    dayKey: string;
  } | null;
};

export type OwnerNotifyPersonStatus = {
  employeeId: string;
  name: string;
  ackedToday: boolean;
  lastAt: number | null;
  lastDayKey: string | null;
};

export const STAFF_TASK_NUDGE_DISMISS_KEY = "telltea_staff_task_nudge_dismiss_v1";
/** หุบ popup งานค้างส่งรอบนี้ (session) — แถบล่างยังอยู่ */
export const STAFF_WORK_NUDGE_DISMISS_KEY = "telltea_staff_work_nudge_dismiss_v1";
/** map occurrenceId → YYYY-MM-DD (Bangkok) ที่รับทราบแล้ว (local optimistic) */
export const STAFF_TASK_DAILY_ACK_KEY = "telltea_staff_task_daily_ack_v1";

const DAY_MS = 86_400_000;

export function staffTaskBangkokDay(now = Date.now()): string {
  return bangkokDateKey(now);
}

export function readDailyAckMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STAFF_TASK_DAILY_ACK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, day] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === "string" && id && typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        out[id] = day;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeDailyAckMap(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STAFF_TASK_DAILY_ACK_KEY, JSON.stringify(map));
}

/** รับทราบวันนี้ — ไม่จบรอบงาน · พรุ่งนี้แจ้งใหม่ (local) */
export function acknowledgeNotifyToday(occurrenceId: string, now = Date.now()): void {
  const id = String(occurrenceId || "").trim();
  if (!id) return;
  const day = staffTaskBangkokDay(now);
  const map = readDailyAckMap();
  map[id] = day;
  const pruned: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v === day) pruned[k] = v;
  }
  pruned[id] = day;
  writeDailyAckMap(pruned);
}

export function isNotifyAckedToday(occurrenceId: string, now = Date.now()): boolean {
  const id = String(occurrenceId || "").trim();
  if (!id) return false;
  const map = readDailyAckMap();
  return map[id] === staffTaskBangkokDay(now);
}

/** local หรือ cloud ของคนนั้น · วันนี้ */
export function isEmployeeNotifyAckedToday(
  occ: TaskOccurrence,
  employeeId: string,
  now = Date.now(),
): boolean {
  const today = staffTaskBangkokDay(now);
  if (isNotifyAckedToday(occ.id, now)) return true;
  const eid = String(employeeId || "").trim();
  if (!eid) return false;
  return occ.notifyAcks?.[eid]?.dayKey === today;
}

export function acknowledgeNotifyTodayMany(occurrenceIds: string[], now = Date.now()): void {
  for (const id of occurrenceIds) acknowledgeNotifyToday(id, now);
}

/** งานแจ้งเตือนที่เปิดแล้ว และยังไม่รับทราบวันนี้ (local + cloud ต่อคน) */
export function actionableStaffTaskNudges(
  occurrences: TaskOccurrence[],
  employeeId = "",
  now = Date.now(),
): StaffTaskNudgeItem[] {
  const ack = readDailyAckMap();
  const today = staffTaskBangkokDay(now);
  const eid = String(employeeId || "").trim();
  return occurrences
    .filter((o) => o.status === "pending" && now >= (o.openAt || 0))
    .filter((o) => isNotifyOnlyNudge(o.nudgeKind))
    .filter((o) => {
      if (ack[o.id] === today) return false;
      if (eid && o.notifyAcks?.[eid]?.dayKey === today) return false;
      return true;
    })
    .map((o) => ({
      id: o.id,
      title: (o.title || "").trim() || "งาน",
      note: (o.note || "").trim(),
      dueDate: Number(o.dueDate) || 0,
      nudgeKind: normalizeTaskNudgeKind(o.nudgeKind),
      periodKey: o.periodKey || "",
    }))
    .sort((a, b) => {
      const ua = a.nudgeKind === "deadline" ? 0 : 1;
      const ub = b.nudgeKind === "deadline" ? 0 : 1;
      if (ua !== ub) return ua - ub;
      if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
      return a.title.localeCompare(b.title, "th");
    });
}

export function staffTaskNudgeFingerprint(items: StaffTaskNudgeItem[]): string {
  return items
    .map((i) => `${i.id}:${i.nudgeKind}:${i.dueDate}`)
    .sort()
    .join("|");
}

export function summarizeStaffTaskNudges(items: StaffTaskNudgeItem[]): {
  total: number;
  soft: number;
  deadline: number;
  headline: string;
} {
  const soft = items.filter((i) => i.nudgeKind === "soft").length;
  const deadline = items.filter((i) => i.nudgeKind === "deadline").length;
  const total = items.length;
  const first = items[0];
  const headline = first
    ? total === 1
      ? first.title
      : `${first.title} · อีก ${total - 1}`
    : "";
  return { total, soft, deadline, headline };
}

/** งานส่งที่เปิดแล้ว (ไม่ใช่แจ้งเบา) — ค้างส่ง / รอ / พลาด */
export function actionableStaffWorkItems(
  occurrences: TaskOccurrence[],
  now = Date.now(),
): StaffWorkNudgeItem[] {
  return occurrences
    .filter((o) => !isNotifyOnlyNudge(o.nudgeKind))
    .filter(
      (o) =>
        (o.status === "pending" || o.status === "waiting" || o.status === "missed") &&
        now >= (o.openAt || 0),
    )
    .map((o) => {
      const dueDate = Number(o.dueDate) || 0;
      const status =
        o.status === "missed"
          ? ("missed" as const)
          : o.status === "waiting"
            ? ("waiting" as const)
            : ("pending" as const);
      let urgency: StaffWorkNudgeItem["urgency"] = "open";
      if (status === "missed" || (dueDate > 0 && now > dueDate + DAY_MS)) {
        urgency = "overdue";
      } else if (dueDate > 0 && dueDate - now <= 2 * DAY_MS) {
        urgency = "dueSoon";
      }
      return {
        id: o.id,
        title: (o.title || "").trim() || "งาน",
        note: (o.note || "").trim(),
        dueDate,
        status,
        urgency,
      };
    })
    .sort((a, b) => {
      const rank = (u: StaffWorkNudgeItem["urgency"]) =>
        u === "overdue" ? 0 : u === "dueSoon" ? 1 : 2;
      const ra = rank(a.urgency);
      const rb = rank(b.urgency);
      if (ra !== rb) return ra - rb;
      if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
      return a.title.localeCompare(b.title, "th");
    });
}

export function staffWorkNudgeFingerprint(items: StaffWorkNudgeItem[]): string {
  return items
    .map((i) => `${i.id}:${i.status}:${i.dueDate}`)
    .sort()
    .join("|");
}

export function summarizeStaffWorkNudges(items: StaffWorkNudgeItem[]): {
  total: number;
  overdue: number;
  headline: string;
} {
  const overdue = items.filter((i) => i.urgency === "overdue").length;
  const total = items.length;
  const first = items[0];
  const headline = first
    ? total === 1
      ? first.title
      : `${first.title} · อีก ${total - 1}`
    : "";
  return { total, overdue, headline };
}

/** สรุปการรับทราบสำหรับเจ้าของ — วันนี้ + ล่าสุดก็พอ */
export function summarizeOwnerNotifyAcks(
  occ: TaskOccurrence,
  now = Date.now(),
): OwnerNotifyAckSummary {
  const today = staffTaskBangkokDay(now);
  const ids = Array.isArray(occ.assigneeIds) ? occ.assigneeIds.map(String) : [];
  const names = Array.isArray(occ.assigneeNames) ? occ.assigneeNames.map(String) : [];
  const ackedTodayNames: string[] = [];
  const pendingTodayNames: string[] = [];
  const people: OwnerNotifyPersonStatus[] = [];
  let lastAck: OwnerNotifyAckSummary["lastAck"] = null;

  for (let i = 0; i < ids.length; i++) {
    const employeeId = ids[i]?.trim();
    if (!employeeId) continue;
    const fallbackName = (names[i] || "").trim() || "ไม่ระบุชื่อ";
    const ack = occ.notifyAcks?.[employeeId];
    const displayName = (ack?.name || "").trim() || fallbackName;
    const ackedToday = ack?.dayKey === today;
    if (ackedToday) ackedTodayNames.push(displayName);
    else pendingTodayNames.push(fallbackName);
    people.push({
      employeeId,
      name: displayName,
      ackedToday,
      lastAt: ack && typeof ack.at === "number" && ack.at > 0 ? ack.at : null,
      lastDayKey: ack?.dayKey || null,
    });
    if (ack && typeof ack.at === "number" && ack.at > 0) {
      if (!lastAck || ack.at > lastAck.at) {
        lastAck = {
          employeeId,
          name: displayName,
          at: ack.at,
          dayKey: ack.dayKey,
        };
      }
    }
  }

  if (occ.notifyAcks) {
    for (const [employeeId, ack] of Object.entries(occ.notifyAcks)) {
      if (!employeeId || !ack || typeof ack.at !== "number" || ack.at <= 0) continue;
      if (ids.includes(employeeId)) continue;
      const displayName = (ack.name || "").trim() || "ไม่ระบุชื่อ";
      if (!lastAck || ack.at > lastAck.at) {
        lastAck = {
          employeeId,
          name: displayName,
          at: ack.at,
          dayKey: ack.dayKey,
        };
      }
    }
  }

  return {
    assigneeCount: ids.filter(Boolean).length,
    ackedTodayCount: ackedTodayNames.length,
    pendingTodayCount: pendingTodayNames.length,
    ackedTodayNames,
    pendingTodayNames,
    people,
    lastAck,
  };
}

/** ข่าวสารเปิดแล้วที่เจ้าของติดตาม (pending + ถึงเวลาแจ้ง) */
export function openOwnerNewsOccurrences(
  occurrences: TaskOccurrence[],
  now = Date.now(),
): TaskOccurrence[] {
  return occurrences
    .filter((o) => o.status === "pending" && now >= (o.openAt || 0))
    .filter((o) => isNotifyOnlyNudge(o.nudgeKind))
    .slice()
    .sort((a, b) => {
      const ua = a.nudgeKind === "deadline" ? 0 : 1;
      const ub = b.nudgeKind === "deadline" ? 0 : 1;
      if (ua !== ub) return ua - ub;
      if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
      return (a.title || "").localeCompare(b.title || "", "th");
    });
}
