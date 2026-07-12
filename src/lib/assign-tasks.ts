import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type AssignTaskRecurrence = "once" | "weekly" | "monthly";
export type AssignTaskStatus = "pending" | "completed";

export type AssignChecklistItem = {
  id: string;
  label: string;
};

export type AssignTask = {
  id: string;
  title: string;
  note: string;
  assigneeIds: string[];
  assigneeNames: string[];
  dueDate: number;
  recurrence: AssignTaskRecurrence;
  checklist: AssignChecklistItem[];
  checklistDone: string[];
  status: AssignTaskStatus;
  proofImg?: string;
  assignedBy: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  completedBy?: string;
};

export type AssignTaskInput = {
  title: string;
  note?: string;
  assigneeIds: string[];
  assigneeNames: string[];
  dueDate: number;
  recurrence: AssignTaskRecurrence;
  checklist: AssignChecklistItem[];
  assignedBy: string;
  createdBy: string;
};

function tasksCol() {
  return collection(getDb(), "assignTasks");
}

function mapAssignTask(id: string, data: Record<string, unknown>): AssignTask {
  const checklist = Array.isArray(data.checklist)
    ? (data.checklist as AssignChecklistItem[]).map((c) => ({
        id: String(c.id || ""),
        label: String(c.label || ""),
      }))
    : [];
  const checklistDone = Array.isArray(data.checklistDone)
    ? (data.checklistDone as string[]).map(String)
    : [];
  return {
    id,
    title: String(data.title || ""),
    note: String(data.note || ""),
    assigneeIds: Array.isArray(data.assigneeIds) ? (data.assigneeIds as string[]) : [],
    assigneeNames: Array.isArray(data.assigneeNames) ? (data.assigneeNames as string[]) : [],
    dueDate: Number(data.dueDate) || 0,
    recurrence: (data.recurrence as AssignTaskRecurrence) || "once",
    checklist,
    checklistDone,
    status: (data.status as AssignTaskStatus) || "pending",
    proofImg: data.proofImg ? String(data.proofImg) : undefined,
    assignedBy: String(data.assignedBy || ""),
    createdBy: String(data.createdBy || ""),
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || 0,
    completedAt: data.completedAt != null ? Number(data.completedAt) : undefined,
    completedBy: data.completedBy ? String(data.completedBy) : undefined,
  };
}

export function subscribeAllAssignTasks(
  onRows: (rows: AssignTask[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(tasksCol(), orderBy("dueDate", "asc"), orderBy("createdAt", "desc")),
    (snap) => {
      onRows(snap.docs.map((d) => mapAssignTask(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribeAssignTasksForEmployee(
  employeeId: string,
  onRows: (rows: AssignTask[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      tasksCol(),
      where("assigneeIds", "array-contains", employeeId),
      orderBy("dueDate", "asc"),
      orderBy("createdAt", "desc"),
    ),
    (snap) => {
      onRows(snap.docs.map((d) => mapAssignTask(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function createAssignTask(input: AssignTaskInput): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("ต้องใส่ชื่องาน");
  if (!input.assigneeIds.length) throw new Error("เลือกพนักงานอย่างน้อย 1 คน");
  const checklist = input.checklist
    .map((c) => ({ id: c.id, label: c.label.trim() }))
    .filter((c) => c.label);
  if (!checklist.length) throw new Error("ต้องมี checklist อย่างน้อย 1 ข้อ");
  const now = Date.now();
  const ref = await addDoc(tasksCol(), {
    title,
    note: (input.note || "").trim(),
    assigneeIds: input.assigneeIds,
    assigneeNames: input.assigneeNames,
    dueDate: input.dueDate,
    recurrence: input.recurrence,
    checklist,
    checklistDone: [],
    status: "pending" as AssignTaskStatus,
    proofImg: "",
    assignedBy: input.assignedBy,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function completeAssignTask(
  id: string,
  patch: {
    checklistDone: string[];
    proofImg: string;
    completedBy: string;
  },
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(getDb(), "assignTasks", id), {
    checklistDone: patch.checklistDone,
    proofImg: patch.proofImg.trim(),
    status: "completed",
    completedAt: now,
    completedBy: patch.completedBy,
    updatedAt: now,
  });
}

export async function deleteAssignTask(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "assignTasks", id));
}
