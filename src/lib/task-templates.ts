import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { TaskChecklistItem, TaskTemplate, TaskTemplateInput } from "./task-types";
import { DEFAULT_OPEN_DAYS_BEFORE } from "./task-weekly-logic";

function templatesCol() {
  return collection(getDb(), "taskTemplates");
}

function mapTemplate(id: string, data: Record<string, unknown>): TaskTemplate {
  const checklist = Array.isArray(data.checklist)
    ? (data.checklist as TaskChecklistItem[]).map((c) => ({
        id: String(c.id || ""),
        label: String(c.label || ""),
      }))
    : [];
  return {
    id,
    title: String(data.title || ""),
    note: String(data.note || ""),
    weekday: Number(data.weekday ?? 1),
    openDaysBefore: Number(data.openDaysBefore ?? DEFAULT_OPEN_DAYS_BEFORE),
    checklist,
    assigneeIds: Array.isArray(data.assigneeIds) ? (data.assigneeIds as string[]) : [],
    assigneeNames: Array.isArray(data.assigneeNames) ? (data.assigneeNames as string[]) : [],
    active: data.active !== false,
    createdBy: String(data.createdBy || ""),
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || 0,
  };
}

export function subscribeTaskTemplates(
  onRows: (rows: TaskTemplate[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(templatesCol(), orderBy("createdAt", "desc")),
    (snap) => {
      onRows(snap.docs.map((d) => mapTemplate(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function createTaskTemplate(input: TaskTemplateInput): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("ต้องใส่ชื่องาน");
  if (!input.assigneeIds.length) throw new Error("เลือกพนักงานอย่างน้อย 1 คน");
  const checklist = input.checklist
    .map((c) => ({ id: c.id, label: c.label.trim() }))
    .filter((c) => c.label);
  if (!checklist.length) throw new Error("ต้องมี checklist อย่างน้อย 1 ข้อ");
  const now = Date.now();
  const ref = await addDoc(templatesCol(), {
    title,
    note: (input.note || "").trim(),
    weekday: input.weekday,
    openDaysBefore: input.openDaysBefore ?? DEFAULT_OPEN_DAYS_BEFORE,
    checklist,
    assigneeIds: input.assigneeIds,
    assigneeNames: input.assigneeNames,
    active: true,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function deactivateTaskTemplate(id: string): Promise<void> {
  await updateDoc(doc(getDb(), "taskTemplates", id), {
    active: false,
    updatedAt: Date.now(),
  });
}

export type TaskTemplatePatch = {
  title: string;
  note?: string;
  weekday: number;
  openDaysBefore?: number;
  checklist: TaskChecklistItem[];
  assigneeIds: string[];
  assigneeNames: string[];
};

function validateTemplatePatch(input: TaskTemplatePatch) {
  const title = input.title.trim();
  if (!title) throw new Error("ต้องใส่ชื่องาน");
  if (!input.assigneeIds.length) throw new Error("เลือกพนักงานอย่างน้อย 1 คน");
  const checklist = input.checklist
    .map((c) => ({ id: c.id, label: c.label.trim() }))
    .filter((c) => c.label);
  if (!checklist.length) throw new Error("ต้องมี checklist อย่างน้อย 1 ข้อ");
  return { title, checklist };
}

export async function updateTaskTemplate(id: string, input: TaskTemplatePatch): Promise<void> {
  const { title, checklist } = validateTemplatePatch(input);
  await updateDoc(doc(getDb(), "taskTemplates", id), {
    title,
    note: (input.note || "").trim(),
    weekday: input.weekday,
    openDaysBefore: input.openDaysBefore ?? DEFAULT_OPEN_DAYS_BEFORE,
    checklist,
    assigneeIds: input.assigneeIds,
    assigneeNames: input.assigneeNames,
    updatedAt: Date.now(),
  });
}

export async function deleteTaskTemplate(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "taskTemplates", id));
}
