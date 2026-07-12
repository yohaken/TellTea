export type TaskChecklistItem = {
  id: string;
  label: string;
};

export type TaskTemplate = {
  id: string;
  title: string;
  note: string;
  weekday: number;
  openDaysBefore: number;
  checklist: TaskChecklistItem[];
  assigneeIds: string[];
  assigneeNames: string[];
  active: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type TaskOccurrenceStatus = "pending" | "completed" | "missed";

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
  checklistDone: string[];
  proofImg?: string;
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
  createdBy: string;
};
