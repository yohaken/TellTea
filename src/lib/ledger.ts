import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentSnapshot,
  getAggregateFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { LedgerEntry, LedgerEntryInput } from "./types";
import type { ImportLedgerRow } from "./xlsx-import";

export const LEDGER_PAGE_SIZE = 60;

export type LedgerPage = {
  entries: LedgerEntry[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
};

function mapEntry(d: QueryDocumentSnapshot): LedgerEntry {
  return { id: d.id, ...(d.data() as Omit<LedgerEntry, "id">) };
}

/** Newest first — for the ledger table (paginated). */
export async function listLedgerPage(
  pageSize = LEDGER_PAGE_SIZE,
  after?: DocumentSnapshot | null,
): Promise<LedgerPage> {
  const col = collection(getDb(), "ledger");
  const q = after
    ? query(
        col,
        orderBy("date", "desc"),
        orderBy("createdAt", "desc"),
        startAfter(after),
        limit(pageSize),
      )
    : query(col, orderBy("date", "desc"), orderBy("createdAt", "desc"), limit(pageSize));

  const snap = await getDocs(q);
  const docs = snap.docs;
  return {
    entries: docs.map(mapEntry),
    cursor: docs.length ? docs[docs.length - 1]! : null,
    hasMore: docs.length >= pageSize,
  };
}

/** Fast balance without downloading every row. */
export async function getLedgerBalance(): Promise<number> {
  const snap = await getAggregateFromServer(collection(getDb(), "ledger"), {
    totalIn: sum("amountIn"),
    totalOut: sum("amountOut"),
  });
  return (snap.data().totalIn || 0) - (snap.data().totalOut || 0);
}

/** Full scan — only for rare tools (import preview / migration). Prefer paginated APIs. */
export async function listLedgerEntries(): Promise<LedgerEntry[]> {
  const snap = await getDocs(
    query(collection(getDb(), "ledger"), orderBy("date", "asc"), orderBy("createdAt", "asc")),
  );
  return snap.docs.map(mapEntry);
}

/** Recent outs for suggestion chips — small page only. */
export async function listRecentLedgerEntries(max = 200): Promise<LedgerEntry[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), "ledger"),
      orderBy("date", "desc"),
      orderBy("createdAt", "desc"),
      limit(max),
    ),
  );
  return snap.docs.map(mapEntry);
}

function validateLedgerPayload(payload: {
  description: string;
  amountIn: number;
  amountOut: number;
}) {
  if (payload.amountIn < 0 || payload.amountOut < 0) {
    throw new Error("จำนวนเงินต้องไม่ติดลบ");
  }
  if (payload.amountIn > 0 && payload.amountOut > 0) {
    throw new Error("ใส่ได้แค่เข้า หรือ ออก อย่างใดอย่างหนึ่ง");
  }
  if (payload.amountIn === 0 && payload.amountOut === 0) {
    throw new Error("ต้องใส่จำนวนเงิน");
  }
  if (!payload.description) {
    throw new Error("ต้องใส่รายการ");
  }
}

export async function addLedgerEntry(input: LedgerEntryInput): Promise<string> {
  const payload = {
    date: input.date,
    description: input.description.trim(),
    amountIn: Number(input.amountIn) || 0,
    amountOut: Number(input.amountOut) || 0,
    type: (input.type || "").trim(),
    createdBy: input.createdBy,
    createdAt: Date.now(),
    receiptUrl: input.receiptUrl || "",
  };
  validateLedgerPayload(payload);
  const ref = await addDoc(collection(getDb(), "ledger"), payload);
  return ref.id;
}

export async function updateLedgerEntry(
  id: string,
  patch: Partial<
    Pick<LedgerEntry, "date" | "description" | "amountIn" | "amountOut" | "type" | "receiptUrl">
  >,
): Promise<void> {
  const next: Record<string, string | number> = {};
  if (patch.date != null) next.date = patch.date;
  if (patch.description != null) next.description = patch.description.trim();
  if (patch.amountIn != null) next.amountIn = Number(patch.amountIn);
  if (patch.amountOut != null) next.amountOut = Number(patch.amountOut);
  if (patch.type != null) next.type = patch.type;
  if (patch.receiptUrl != null) next.receiptUrl = patch.receiptUrl;

  if (next.amountIn != null && next.amountOut != null) {
    validateLedgerPayload({
      description: String(next.description || "-"),
      amountIn: Number(next.amountIn),
      amountOut: Number(next.amountOut),
    });
  }
  await updateDoc(doc(getDb(), "ledger", id), next);
}

export async function importLedgerEntries(
  rows: ImportLedgerRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const db = getDb();
  const chunkSize = 400;
  let done = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const row of chunk) {
      const ref = doc(collection(db, "ledger"));
      batch.set(ref, {
        date: row.date,
        description: row.description,
        amountIn: row.amountIn,
        amountOut: row.amountOut,
        type: row.type || "",
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        receiptUrl: "",
      });
    }
    await batch.commit();
    done += chunk.length;
    onProgress?.(done, rows.length);
  }

  return done;
}

export async function deleteAllLedgerEntries(
  onProgress?: (done: number) => void,
): Promise<number> {
  const db = getDb();
  let deleted = 0;
  for (;;) {
    const snap = await getDocs(
      query(collection(db, "ledger"), orderBy("createdAt", "asc"), limit(400)),
    );
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.docs.length;
    onProgress?.(deleted);
    if (snap.docs.length < 400) break;
  }
  return deleted;
}

export async function deleteLedgerEntry(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "ledger", id));
}

export function withRunningBalance(entries: LedgerEntry[]) {
  let balance = 0;
  return entries.map((entry) => {
    balance += entry.amountIn - entry.amountOut;
    return { ...entry, balance };
  });
}

export function currentBalance(entries: LedgerEntry[]) {
  return entries.reduce((sum, e) => sum + e.amountIn - e.amountOut, 0);
}

/** รายการที่ใช้บ่อย — เรียงตามความถี่แล้วความใหม่ */
export function frequentDescriptions(entries: LedgerEntry[], limitCount = 12): string[] {
  const map = new Map<string, { count: number; last: number }>();
  for (const e of entries) {
    const key = e.description.trim();
    if (!key || e.amountOut <= 0) continue;
    const prev = map.get(key);
    if (prev) {
      prev.count += 1;
      prev.last = Math.max(prev.last, e.createdAt || e.date);
    } else {
      map.set(key, { count: 1, last: e.createdAt || e.date });
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .slice(0, limitCount)
    .map(([name]) => name);
}
