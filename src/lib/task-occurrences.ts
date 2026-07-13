import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { TaskOccurrence, TaskOccurrenceStatus } from "./task-types";
import {
  computeCompletedKind,
  type SyncCreateOp,
  type SyncMissedOp,
} from "./task-weekly-logic";

function occurrencesCol() {
  return collection(getDb(), "taskOccurrences");
}

function mapOccurrence(id: string, data: Record<string, unknown>): TaskOccurrence {
  const checklist = Array.isArray(data.checklist)
    ? (data.checklist as { id: string; label: string }[]).map((c) => ({
        id: String(c.id || ""),
        label: String(c.label || ""),
      }))
    : [];
  const checklistDone = Array.isArray(data.checklistDone)
    ? (data.checklistDone as string[]).map(String)
    : [];
  return {
    id,
    templateId: String(data.templateId || ""),
    periodKey: String(data.periodKey || ""),
    title: String(data.title || ""),
    note: String(data.note || ""),
    checklist,
    assigneeIds: Array.isArray(data.assigneeIds) ? (data.assigneeIds as string[]) : [],
    assigneeNames: Array.isArray(data.assigneeNames) ? (data.assigneeNames as string[]) : [],
    dueDate: Number(data.dueDate) || 0,
    openAt: Number(data.openAt) || 0,
    status: (data.status as TaskOccurrenceStatus) || "pending",
    checklistDone,
    proofImg: data.proofImg ? String(data.proofImg) : undefined,
    completedAt: data.completedAt != null ? Number(data.completedAt) : undefined,
    completedBy: data.completedBy ? String(data.completedBy) : undefined,
    completedKind: data.completedKind as TaskOccurrence["completedKind"],
    wasMissedBeforeBackfill: data.wasMissedBeforeBackfill === true,
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || 0,
  };
}

export function subscribeTaskOccurrences(
  onRows: (rows: TaskOccurrence[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(occurrencesCol(), orderBy("dueDate", "desc"), orderBy("createdAt", "desc")),
    (snap) => {
      onRows(snap.docs.map((d) => mapOccurrence(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** พนักงาน — เฉพาะรอบที่มอบให้ตนเอง */
export function subscribeTaskOccurrencesForAssignee(
  assigneeId: string,
  onRows: (rows: TaskOccurrence[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      occurrencesCol(),
      where("assigneeIds", "array-contains", assigneeId),
      orderBy("dueDate", "desc"),
      orderBy("createdAt", "desc"),
    ),
    (snap) => {
      onRows(snap.docs.map((d) => mapOccurrence(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function applySyncOperations(
  create: SyncCreateOp[],
  markMissed: SyncMissedOp[],
): Promise<void> {
  if (!create.length && !markMissed.length) return;
  const batch = writeBatch(getDb());
  const now = Date.now();

  for (const op of create) {
    const ref = doc(occurrencesCol());
    batch.set(ref, {
      templateId: op.templateId,
      periodKey: op.periodKey,
      title: op.title,
      note: op.note,
      checklist: op.checklist,
      assigneeIds: op.assigneeIds,
      assigneeNames: op.assigneeNames,
      dueDate: op.dueDate,
      openAt: op.openAt,
      status: "pending",
      checklistDone: [],
      proofImg: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const op of markMissed) {
    batch.update(doc(getDb(), "taskOccurrences", op.occurrenceId), {
      status: "missed",
      updatedAt: now,
    });
  }

  await batch.commit();
}

export async function completeTaskOccurrence(
  occ: TaskOccurrence,
  patch: {
    checklistDone: string[];
    proofImg: string;
    completedBy: string;
  },
): Promise<void> {
  const now = Date.now();
  const wasMissed = occ.status === "missed";
  const completedKind = computeCompletedKind(occ.dueDate, now, wasMissed);
  await updateDoc(doc(getDb(), "taskOccurrences", occ.id), {
    checklistDone: patch.checklistDone,
    proofImg: patch.proofImg.trim(),
    status: "completed",
    completedAt: now,
    completedBy: patch.completedBy,
    completedKind,
    wasMissedBeforeBackfill: wasMissed,
    updatedAt: now,
  });
}

export async function deleteTaskOccurrences(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const batch = writeBatch(getDb());
  for (const id of ids) {
    batch.delete(doc(getDb(), "taskOccurrences", id));
  }
  await batch.commit();
}

export async function syncPendingOccurrencesFromTemplate(
  template: Pick<TaskOccurrence, "templateId"> & {
    title: string;
    note: string;
    checklist: TaskOccurrence["checklist"];
    assigneeIds: string[];
    assigneeNames: string[];
  },
  occurrenceIds: string[],
): Promise<void> {
  if (!occurrenceIds.length) return;
  const batch = writeBatch(getDb());
  const now = Date.now();
  for (const id of occurrenceIds) {
    batch.update(doc(getDb(), "taskOccurrences", id), {
      title: template.title,
      note: template.note,
      checklist: template.checklist,
      assigneeIds: template.assigneeIds,
      assigneeNames: template.assigneeNames,
      updatedAt: now,
    });
  }
  await batch.commit();
}

/** @deprecated used only if direct create needed in tests */
export async function createTaskOccurrenceDirect(data: Omit<TaskOccurrence, "id">) {
  await addDoc(occurrencesCol(), data);
}
