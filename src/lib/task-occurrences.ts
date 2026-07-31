import {
  addDoc,
  arrayUnion,
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
import { daysAgoMs } from "./query-window";
import {
  normalizeTaskNudgeKind,
  type TaskOccurrence,
  type TaskOccurrenceStatus,
} from "./task-types";
import {
  computeCompletedKind,
  occurrenceDocId,
  type SyncCreateOp,
  type SyncDeleteOp,
  type SyncMissedOp,
} from "./task-weekly-logic";

/** พอสำหรับแท็บ missed (4 สัปดาห์) + ประวัติใกล้ๆ — ไม่ sync งานเก่าทั้งก้อน */
export const TASK_OCCURRENCE_LOOKBACK_DAYS = 120;

export function taskOccurrenceSinceMs(
  now = Date.now(),
  days: number = TASK_OCCURRENCE_LOOKBACK_DAYS,
): number {
  return daysAgoMs(days, now);
}

function occurrencesCol() {
  return collection(getDb(), "taskOccurrences");
}

function normalizeOccurrenceStatus(raw: unknown): TaskOccurrenceStatus {
  if (raw === "waiting" || raw === "completed" || raw === "missed") return raw;
  return "pending";
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
    status: normalizeOccurrenceStatus(data.status),
    nudgeKind: normalizeTaskNudgeKind(data.nudgeKind),
    checklistDone,
    proofImg: data.proofImg ? String(data.proofImg) : undefined,
    proofImgs: Array.isArray(data.proofImgs)
      ? (data.proofImgs as string[]).map(String).filter((u) => u.trim())
      : data.proofImg
        ? [String(data.proofImg)]
        : [],
    completionNote: data.completionNote ? String(data.completionNote) : undefined,
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
  opts?: { since?: number },
): Unsubscribe {
  const since = opts?.since;
  const q =
    since != null
      ? query(
          occurrencesCol(),
          where("dueDate", ">=", since),
          orderBy("dueDate", "desc"),
          orderBy("createdAt", "desc"),
        )
      : query(occurrencesCol(), orderBy("dueDate", "desc"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
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
  opts?: { since?: number },
): Unsubscribe {
  const since = opts?.since;
  const q =
    since != null
      ? query(
          occurrencesCol(),
          where("assigneeIds", "array-contains", assigneeId),
          where("dueDate", ">=", since),
          orderBy("dueDate", "desc"),
          orderBy("createdAt", "desc"),
        )
      : query(
          occurrencesCol(),
          where("assigneeIds", "array-contains", assigneeId),
          orderBy("dueDate", "desc"),
          orderBy("createdAt", "desc"),
        );
  return onSnapshot(
    q,
    (snap) => {
      onRows(snap.docs.map((d) => mapOccurrence(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function applySyncOperations(
  create: SyncCreateOp[],
  markMissed: SyncMissedOp[],
  deleteDupes: SyncDeleteOp[] = [],
): Promise<void> {
  if (!create.length && !markMissed.length && !deleteDupes.length) return;
  const batch = writeBatch(getDb());
  const now = Date.now();

  for (const op of deleteDupes) {
    batch.delete(doc(getDb(), "taskOccurrences", op.occurrenceId));
  }

  for (const op of create) {
    const ref = doc(getDb(), "taskOccurrences", occurrenceDocId(op.templateId, op.periodKey));
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
      nudgeKind: normalizeTaskNudgeKind(op.nudgeKind),
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

function normalizeProofImgs(patch: { proofImg?: string; proofImgs?: string[] }) {
  return (patch.proofImgs || (patch.proofImg ? [patch.proofImg] : []))
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** พนักงานรายงานว่าทำขั้นกลางแล้ว — หยุดแจ้งเตือน · ค้างติดตามหลังร้าน */
export async function reportTaskOccurrenceWaiting(
  occ: TaskOccurrence,
  patch: {
    checklistDone?: string[];
    proofImg?: string;
    proofImgs?: string[];
    completionNote: string;
    completedBy: string;
  },
): Promise<void> {
  const completionNote = (patch.completionNote || "").trim().slice(0, 280);
  if (!completionNote) {
    throw new Error("ใส่ข้อความ เช่น ส่งซ่อมแล้ว กำลังรอร้าน");
  }
  const now = Date.now();
  const proofImgs = normalizeProofImgs(patch);
  await updateDoc(doc(getDb(), "taskOccurrences", occ.id), {
    checklistDone: patch.checklistDone || occ.checklistDone || [],
    proofImg: proofImgs[0] || occ.proofImg || "",
    proofImgs: proofImgs.length ? proofImgs : getExistingProofs(occ),
    completionNote,
    status: "waiting",
    completedBy: patch.completedBy,
    updatedAt: now,
  });
}

function getExistingProofs(occ: TaskOccurrence): string[] {
  if (Array.isArray(occ.proofImgs) && occ.proofImgs.length) {
    return occ.proofImgs.map(String).filter((u) => u.trim()).slice(0, 6);
  }
  return occ.proofImg ? [occ.proofImg] : [];
}

export async function completeTaskOccurrence(
  occ: TaskOccurrence,
  patch: {
    checklistDone: string[];
    proofImg?: string;
    proofImgs?: string[];
    completionNote?: string;
    completedBy: string;
  },
): Promise<void> {
  const now = Date.now();
  const wasMissed = occ.status === "missed";
  const completedKind = computeCompletedKind(occ.dueDate, now, wasMissed);
  const proofImgs = normalizeProofImgs(patch);
  const completionNote = (patch.completionNote || "").trim().slice(0, 280);
  await updateDoc(doc(getDb(), "taskOccurrences", occ.id), {
    checklistDone: patch.checklistDone,
    proofImg: proofImgs[0] || "",
    proofImgs,
    completionNote,
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

/** รอบที่ยังไม่จบ — pending / waiting / missed */
export function isOpenTaskOccurrenceStatus(status: TaskOccurrenceStatus) {
  return status === "pending" || status === "missed" || status === "waiting";
}

/**
 * รวบรวมรอบที่ยังไม่จบของกติกา + เอกสารซ้ำ periodKey เดียวกัน
 * (ตาราง thisWeek โชว์แค่ 1 แถว/กติกา — ลบแถวเดียวแล้วพี่น้องโผล่แทน)
 */
export function collectOpenTaskOccurrences(
  templateId: string,
  occurrences: TaskOccurrence[],
): TaskOccurrence[] {
  const tid = String(templateId || "").trim();
  if (!tid) return [];
  const open = occurrences.filter(
    (o) => o.templateId === tid && isOpenTaskOccurrenceStatus(o.status),
  );
  const periodKeys = new Set(open.map((o) => o.periodKey).filter(Boolean));
  const byId = new Map<string, TaskOccurrence>();
  for (const o of occurrences) {
    if (o.templateId !== tid) continue;
    if (o.status === "completed") continue;
    if (periodKeys.has(o.periodKey) || isOpenTaskOccurrenceStatus(o.status)) {
      byId.set(o.id, o);
    }
  }
  return [...byId.values()];
}

/**
 * dismiss periodKeys + ลบรอบที่ยังไม่จบ ใน batch เดียว
 * กัน sync สร้างซ้ำ และกันลบแล้วแถวพี่น้องโผล่แทน
 */
export async function dismissAndDeleteOpenTaskOccurrences(
  templateId: string,
  occurrences: TaskOccurrence[],
): Promise<{ deletedIds: string[]; periodKeys: string[] }> {
  const tid = String(templateId || "").trim();
  if (!tid) throw new Error("ไม่พบกติกางาน");
  const open = collectOpenTaskOccurrences(tid, occurrences);
  const periodKeys = [...new Set(open.map((o) => o.periodKey).filter(Boolean))];
  const ids = open.map((o) => o.id);
  if (!ids.length && !periodKeys.length) {
    return { deletedIds: [], periodKeys: [] };
  }

  const batch = writeBatch(getDb());
  if (periodKeys.length) {
    batch.update(doc(getDb(), "taskTemplates", tid), {
      dismissedPeriodKeys: arrayUnion(...periodKeys),
      updatedAt: Date.now(),
    });
  }
  for (const id of ids) {
    batch.delete(doc(getDb(), "taskOccurrences", id));
  }
  await batch.commit();
  return { deletedIds: ids, periodKeys };
}

/** ปิดกติกา + ลบรอบที่ยังไม่จบออกจากตารางทันที */
export async function deactivateTaskTemplateClearingOpen(
  templateId: string,
  occurrences: TaskOccurrence[],
): Promise<void> {
  const tid = String(templateId || "").trim();
  if (!tid) throw new Error("ไม่พบกติกางาน");
  const open = collectOpenTaskOccurrences(tid, occurrences);
  const periodKeys = [...new Set(open.map((o) => o.periodKey).filter(Boolean))];
  const batch = writeBatch(getDb());
  const patch: Record<string, unknown> = {
    active: false,
    updatedAt: Date.now(),
  };
  if (periodKeys.length) {
    patch.dismissedPeriodKeys = arrayUnion(...periodKeys);
  }
  batch.update(doc(getDb(), "taskTemplates", tid), patch);
  for (const o of open) {
    batch.delete(doc(getDb(), "taskOccurrences", o.id));
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
    nudgeKind?: TaskOccurrence["nudgeKind"];
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
      nudgeKind: normalizeTaskNudgeKind(template.nudgeKind),
      updatedAt: now,
    });
  }
  await batch.commit();
}

/** @deprecated used only if direct create needed in tests */
export async function createTaskOccurrenceDirect(data: Omit<TaskOccurrence, "id">) {
  await addDoc(occurrencesCol(), data);
}
