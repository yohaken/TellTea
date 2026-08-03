/**
 * กระดานโนตงาน (/tasks/) — พนักงานใส่ความคืบ · เจ้าของพิมพ์ได้
 * แทนระบบ checklist / taskTemplates · เก็บที่ taskBoardNotes/{id}
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

export const TASK_BOARD_NOTES_COL = "taskBoardNotes";
export const TASK_BOARD_NOTE_MAX = 500;
export const TASK_BOARD_NOTES_LIMIT = 200;

export type TaskBoardAuthorRole = "owner" | "staff";

export type TaskBoardNote = {
  id: string;
  text: string;
  createdBy: string;
  createdByName: string;
  authorRole: TaskBoardAuthorRole;
  employeeId: string;
  createdAt: number;
  updatedAt: number;
};

function col() {
  return collection(getDb(), TASK_BOARD_NOTES_COL);
}

export function normalizeTaskBoardNoteText(raw: string): string {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, TASK_BOARD_NOTE_MAX);
}

export function mapTaskBoardNote(
  id: string,
  data: Record<string, unknown>,
): TaskBoardNote {
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0;
  const role = data.authorRole === "owner" ? "owner" : "staff";
  return {
    id,
    text: typeof data.text === "string" ? data.text : "",
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName:
      typeof data.createdByName === "string" ? data.createdByName.trim() : "",
    authorRole: role,
    employeeId: typeof data.employeeId === "string" ? data.employeeId : "",
    createdAt,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : createdAt,
  };
}

export function subscribeTaskBoardNotes(opts: {
  onRows: (rows: TaskBoardNote[]) => void;
  onError?: (err: Error) => void;
}): Unsubscribe {
  const q = query(
    col(),
    orderBy("createdAt", "desc"),
    limit(TASK_BOARD_NOTES_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => {
      opts.onRows(
        snap.docs.map((d) =>
          mapTaskBoardNote(d.id, d.data() as Record<string, unknown>),
        ),
      );
    },
    (err) =>
      opts.onError?.(
        err instanceof Error ? err : new Error(mapFirestoreError(err, "โหลดกระดานโนต", "staff")),
      ),
  );
}

export async function createTaskBoardNote(input: {
  text: string;
  createdBy: string;
  createdByName: string;
  authorRole: TaskBoardAuthorRole;
  employeeId?: string;
}): Promise<string> {
  const text = normalizeTaskBoardNoteText(input.text);
  if (!text) throw new Error("ใส่ข้อความก่อนส่ง");
  if (!input.createdBy) throw new Error("เข้าสู่ระบบก่อนโพสต์");
  const now = Date.now();
  try {
    const ref = await addDoc(col(), {
      text,
      createdBy: input.createdBy,
      createdByName: String(input.createdByName || "").trim() || "ไม่ระบุชื่อ",
      authorRole: input.authorRole === "owner" ? "owner" : "staff",
      employeeId: String(input.employeeId || "").trim(),
      createdAt: now,
      updatedAt: now,
    });
    return ref.id;
  } catch (err) {
    throw new Error(mapFirestoreError(err, "โพสต์โนต", "staff"));
  }
}

export async function deleteTaskBoardNote(id: string): Promise<void> {
  const noteId = String(id || "").trim();
  if (!noteId) throw new Error("ไม่พบโนต");
  try {
    await deleteDoc(doc(getDb(), TASK_BOARD_NOTES_COL, noteId));
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ลบโนต", "staff"));
  }
}

export function canDeleteTaskBoardNote(
  note: TaskBoardNote,
  opts: { actorId: string; isOwner: boolean },
): boolean {
  if (opts.isOwner) return true;
  return !!opts.actorId && note.createdBy === opts.actorId;
}
