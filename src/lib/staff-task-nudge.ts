/**
 * งานค้างกึ่งแจ้งเตือน — มุมพนักงานรายคน (employeeId)
 * ดึงจาก taskOccurrences ที่มอบหมาย · แยก soft / deadline
 */
import {
  normalizeTaskNudgeKind,
  type TaskNudgeKind,
  type TaskOccurrence,
} from "./task-types";

export type StaffTaskNudgeItem = {
  id: string;
  title: string;
  note: string;
  dueDate: number;
  nudgeKind: TaskNudgeKind;
  /** pending = ยังไม่ส่ง · waiting = รายงานรอแล้ว (ยังติดตาม) */
  status: "pending" | "waiting";
  periodKey: string;
};

function nudgeSortRank(item: StaffTaskNudgeItem): number {
  if (item.status === "waiting") return 1;
  return item.nudgeKind === "deadline" ? 0 : 2;
}

/** งานที่เปิดทำได้แล้ว (pending/waiting + ถึง openAt) ของพนักงาน */
export function actionableStaffTaskNudges(
  occurrences: TaskOccurrence[],
  now = Date.now(),
): StaffTaskNudgeItem[] {
  return occurrences
    .filter(
      (o) =>
        (o.status === "pending" || o.status === "waiting") &&
        now >= (o.openAt || 0),
    )
    .map((o) => ({
      id: o.id,
      title: (o.title || "").trim() || "งาน",
      note: (o.note || "").trim(),
      dueDate: Number(o.dueDate) || 0,
      nudgeKind: normalizeTaskNudgeKind(o.nudgeKind),
      status: o.status === "waiting" ? ("waiting" as const) : ("pending" as const),
      periodKey: o.periodKey || "",
    }))
    .sort((a, b) => {
      const ua = nudgeSortRank(a);
      const ub = nudgeSortRank(b);
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
  waiting: number;
  headline: string;
} {
  const waiting = items.filter((i) => i.status === "waiting").length;
  const open = items.filter((i) => i.status === "pending");
  const soft = open.filter((i) => i.nudgeKind === "soft").length;
  const deadline = open.filter((i) => i.nudgeKind === "deadline").length;
  const total = items.length;
  const first = items[0];
  const headline = first
    ? total === 1
      ? first.title
      : `${first.title} · อีก ${total - 1}`
    : "";
  return { total, soft, deadline, waiting, headline };
}

export const STAFF_TASK_NUDGE_DISMISS_KEY = "telltea_staff_task_nudge_dismiss_v1";
