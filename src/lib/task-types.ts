export type TaskChecklistItem = {
  id: string;
  label: string;
};

/** โนตความคืบในรอบงาน — แทนเช็คลิสย่อย · พนักงาน+เจ้าของโพสต์ได้ */
export type TaskProgressNote = {
  id: string;
  text: string;
  createdBy: string;
  createdByName: string;
  authorRole: "owner" | "staff";
  createdAt: number;
};

export const TASK_PROGRESS_NOTE_MAX = 280;
export const TASK_PROGRESS_NOTES_MAX = 80;

/**
 * soft = แจ้งเบา (รับทราบวันนี้ · พรุ่งนี้ขึ้นใหม่ · ไม่ใช่ส่งงาน)
 * deadline = มีกำหนด (งานส่ง · มีวันครบ · ส่งรูป/จบได้)
 * task = งานส่ง (ส่งรูป/จบได้)
 */
export type TaskNudgeKind = "soft" | "deadline" | "task";

export type TaskTemplate = {
  id: string;
  title: string;
  note: string;
  weekday: number;
  openDaysBefore: number;
  checklist: TaskChecklistItem[];
  assigneeIds: string[];
  assigneeNames: string[];
  /** ค่าเริ่มต้น task — soft = ข่าวสาร · deadline/task = งานส่ง */
  nudgeKind: TaskNudgeKind;
  active: boolean;
  /** รอบที่เจ้าของลบแล้ว — sync จะไม่สร้างซ้ำ */
  dismissedPeriodKeys?: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

/** waiting = พนักงานรายงานแล้ว (เช่น ส่งซ่อมแล้วรอ) — หยุดแจ้งเตือน แต่ยังติดตามในหลังร้าน */
export type TaskOccurrenceStatus = "pending" | "waiting" | "completed" | "missed";

/** รับทราบล่าสุดของพนักงานต่อรอบแจ้งเตือน (วันต่อวัน · ไม่ใช่ส่งงาน) */
export type TaskNotifyAck = {
  /** Asia/Bangkok YYYY-MM-DD */
  dayKey: string;
  at: number;
  name: string;
};

export type TaskOccurrence = {
  id: string;
  templateId: string;
  periodKey: string;
  title: string;
  note: string;
  checklist: TaskChecklistItem[];
  assigneeIds: string[];
  assigneeNames: string[];
  dueDate: number;
  openAt: number;
  status: TaskOccurrenceStatus;
  nudgeKind: TaskNudgeKind;
  checklistDone: string[];
  /** กระดานโนตความคืบในรอบนี้ (แทนติ๊ก checklist ย่อย) */
  progressNotes: TaskProgressNote[];
  /**
   * รับทราบล่าสุดต่อ employeeId — เจ้าของดูได้
   * dayKey = วันรับทราบล่าสุด · พรุ่งนี้ยังแจ้งใหม่ได้
   */
  notifyAcks: Record<string, TaskNotifyAck>;
  proofImg?: string;
  /** รูปหลักฐานหลายรูป — ถ้าว่างใช้ proofImg */
  proofImgs?: string[];
  /** ข้อความจากพนักงานตอนส่ง — feedback ถึงเจ้าของ */
  completionNote?: string;
  completedAt?: number;
  completedBy?: string;
  completedKind?: "on_time" | "late" | "backfill";
  wasMissedBeforeBackfill?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type TaskTemplateInput = {
  title: string;
  note?: string;
  weekday: number;
  openDaysBefore?: number;
  checklist: TaskChecklistItem[];
  assigneeIds: string[];
  assigneeNames: string[];
  nudgeKind?: TaskNudgeKind;
  createdBy: string;
};

export function normalizeTaskNudgeKind(raw: unknown): TaskNudgeKind {
  if (raw === "soft") return "soft";
  if (raw === "deadline") return "deadline";
  if (raw === "task") return "task";
  // เอกสารเก่าไม่มี nudgeKind = งานส่ง
  return "task";
}

/** ข่าวสารแจ้งเบา — ไม่ใช่งานที่กดส่ง · รับทราบ ≠ completed */
export function isNotifyOnlyNudge(kind: unknown): boolean {
  return normalizeTaskNudgeKind(kind) === "soft";
}

export function labelTaskNudgeKind(kind: unknown): string {
  const k = normalizeTaskNudgeKind(kind);
  if (k === "soft") return "แจ้งเบา";
  if (k === "deadline") return "มีกำหนด";
  return "งานส่ง";
}
