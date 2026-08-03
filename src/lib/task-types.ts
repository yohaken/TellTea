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
 * soft = แจ้งเบาๆ (ปิดได้ · ไม่เน้นเส้นตาย)
 * deadline = ต้องทำตามกำหนด (โชว์วันครบ · แถบค้างชัด)
 */
export type TaskNudgeKind = "soft" | "deadline";

export type TaskTemplate = {
  id: string;
  title: string;
  note: string;
  weekday: number;
  openDaysBefore: number;
  checklist: TaskChecklistItem[];
  assigneeIds: string[];
  assigneeNames: string[];
  /** ค่าเริ่มต้น deadline — งานประจำเดิม */
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
  return raw === "soft" ? "soft" : "deadline";
}
