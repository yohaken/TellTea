import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";

export const STAFF_SUGGESTIONS_COL = "staffSuggestions";

/** ส่งแล้ว → รับไว้ / ยังไม่ทำ / ทำแล้ว */
export const SUGGESTION_STATUSES = ["pending", "accepted", "later", "done"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  pending: "รอดู",
  accepted: "รับไว้",
  later: "ยังไม่ทำ",
  done: "ทำแล้ว",
};

export type StaffSuggestion = {
  id: string;
  title: string;
  body: string;
  status: SuggestionStatus;
  createdBy: string;
  createdByName: string;
  employeeId: string;
  ownerNote: string;
  createdAt: number;
  updatedAt: number;
};

function col() {
  return collection(getDb(), STAFF_SUGGESTIONS_COL);
}

function isStatus(v: unknown): v is SuggestionStatus {
  return typeof v === "string" && (SUGGESTION_STATUSES as readonly string[]).includes(v);
}

export function mapStaffSuggestion(
  id: string,
  data: Record<string, unknown>,
): StaffSuggestion {
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0;
  return {
    id,
    title: typeof data.title === "string" ? data.title.trim() : "",
    body: typeof data.body === "string" ? data.body.trim() : "",
    status: isStatus(data.status) ? data.status : "pending",
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName.trim() : "",
    employeeId: typeof data.employeeId === "string" ? data.employeeId : "",
    ownerNote: typeof data.ownerNote === "string" ? data.ownerNote.trim() : "",
    createdAt,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : createdAt,
  };
}

export function countPendingSuggestions(rows: StaffSuggestion[]): number {
  return rows.filter((r) => r.status === "pending").length;
}

/** เจ้าของ — ทั้งหมด · พนักงาน — ของตัวเอง */
export function subscribeStaffSuggestions(opts: {
  isOwner: boolean;
  actorId: string;
  onRows: (rows: StaffSuggestion[]) => void;
  onError?: (err: Error) => void;
}): Unsubscribe {
  const { isOwner, actorId, onRows, onError } = opts;
  if (!isOwner && !actorId) {
    onRows([]);
    return () => {};
  }

  // พนักงาน: กรอง createdBy อย่างเดียว แล้วเรียงฝั่ง client — เลี่ยง composite index
  const q = isOwner
    ? query(col(), orderBy("createdAt", "desc"))
    : query(col(), where("createdBy", "==", actorId));

  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) =>
        mapStaffSuggestion(d.id, d.data() as Record<string, unknown>),
      );
      if (!isOwner) {
        rows.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
      }
      onRows(rows);
    },
    (err) =>
      onError?.(err instanceof Error ? err : new Error(mapFirestoreError(err))),
  );
}

export async function createStaffSuggestion(input: {
  title: string;
  body: string;
  createdBy: string;
  createdByName: string;
  employeeId?: string;
}): Promise<string> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error("ใส่หัวข้อสั้นๆ ก่อน");
  if (!input.createdBy) throw new Error("เข้าสู่ระบบก่อนส่งข้อเสนอ");
  const now = Date.now();
  const ref = await addDoc(col(), {
    title,
    body,
    status: "pending" satisfies SuggestionStatus,
    createdBy: input.createdBy,
    createdByName: input.createdByName.trim() || input.createdBy,
    employeeId: (input.employeeId || "").trim(),
    ownerNote: "",
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateStaffSuggestionStatus(
  id: string,
  status: SuggestionStatus,
  ownerNote?: string,
): Promise<void> {
  if (!id.trim()) throw new Error("ไม่พบข้อเสนอ");
  if (!isStatus(status)) throw new Error("สถานะไม่ถูกต้อง");
  const patch: Record<string, unknown> = {
    status,
    updatedAt: Date.now(),
  };
  if (ownerNote !== undefined) {
    patch.ownerNote = ownerNote.trim();
  }
  await updateDoc(doc(getDb(), STAFF_SUGGESTIONS_COL, id), patch);
}

export function formatSuggestionWhen(ms: number): string {
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "—";
  }
}
