import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { LedgerEntry } from "./types";
import type { ImportOwnerBookRow } from "./xlsx-import";

export const OWNER_BOOKS_PAGE_SIZE = 60;
export const OWNER_BOOKS_LIVE_MAX = 480;

/** Owner books row — out-only + optional note. */
export type OwnerBookEntry = LedgerEntry & {
  note?: string;
};

export type OwnerBookEntryInput = {
  date: number;
  description: string;
  amountOut: number;
  type: string;
  createdBy: string;
  receiptUrl?: string;
  note?: string;
};

export type OwnerBooksPage = {
  entries: OwnerBookEntry[];
  hasMore: boolean;
};

function mapEntry(d: QueryDocumentSnapshot): OwnerBookEntry {
  const data = d.data() as Omit<OwnerBookEntry, "id">;
  return {
    id: d.id,
    ...data,
    amountIn: 0,
    amountOut: Number(data.amountOut) || 0,
    note: typeof data.note === "string" ? data.note : "",
  };
}

function ownerBooksCol() {
  return collection(getDb(), "ownerBooks");
}

function ownerBooksMetaRef() {
  return doc(getDb(), "meta", "ownerBooks");
}

function validateOwnerPayload(payload: { description: string; amountOut: number }) {
  if (!payload.description.trim()) throw new Error("ต้องใส่รายการ");
  if (!(payload.amountOut > 0)) throw new Error("ต้องใส่จำนวนเงินออก");
}

export function subscribeOwnerBooksPage(
  limitCount: number,
  onPage: (page: OwnerBooksPage) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const size = Math.max(1, Math.min(limitCount, OWNER_BOOKS_LIVE_MAX));
  const q = query(
    ownerBooksCol(),
    orderBy("date", "desc"),
    orderBy("createdAt", "desc"),
    limit(size),
  );
  return onSnapshot(
    q,
    (snap) => {
      onPage({
        entries: snap.docs.map(mapEntry),
        hasMore: snap.docs.length >= size && size < OWNER_BOOKS_LIVE_MAX,
      });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribeOwnerBooksTotalOut(
  onTotal: (totalOut: number) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    ownerBooksMetaRef(),
    (snap) => {
      if (!snap.exists()) {
        onTotal(0);
        return;
      }
      onTotal(Number(snap.data().totalOut) || 0);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

async function recomputeOwnerBooksTotal(): Promise<number> {
  let totalOut = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const snap = await getDocs(
      cursor
        ? query(ownerBooksCol(), orderBy("createdAt", "asc"), startAfter(cursor), limit(400))
        : query(ownerBooksCol(), orderBy("createdAt", "asc"), limit(400)),
    );
    if (snap.empty) break;
    for (const d of snap.docs) {
      totalOut += Number(d.data().amountOut) || 0;
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < 400) break;
  }
  await setDoc(
    ownerBooksMetaRef(),
    { totalOut, balance: -totalOut, updatedAt: Date.now() },
    { merge: true },
  );
  return totalOut;
}

async function applyOwnerOutDelta(deltaOut: number): Promise<void> {
  const d = Number(deltaOut) || 0;
  if (d === 0) return;
  const ref = ownerBooksMetaRef();
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await recomputeOwnerBooksTotal();
    return;
  }
  await setDoc(
    ref,
    {
      totalOut: increment(d),
      balance: increment(-d),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export async function addOwnerBookEntry(input: OwnerBookEntryInput): Promise<string> {
  const payload = {
    date: input.date,
    description: input.description.trim(),
    amountIn: 0,
    amountOut: Number(input.amountOut) || 0,
    type: (input.type || "").trim(),
    createdBy: input.createdBy,
    createdAt: Date.now(),
    receiptUrl: input.receiptUrl || "",
    note: (input.note || "").trim(),
  };
  validateOwnerPayload(payload);
  const ref = await addDoc(ownerBooksCol(), payload);
  await applyOwnerOutDelta(payload.amountOut);
  return ref.id;
}

export async function updateOwnerBookEntry(
  id: string,
  patch: Partial<
    Pick<OwnerBookEntry, "date" | "description" | "amountOut" | "type" | "receiptUrl" | "note">
  >,
): Promise<void> {
  const entryRef = doc(getDb(), "ownerBooks", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) throw new Error("ไม่พบรายการ");
  const prev = prevSnap.data() as OwnerBookEntry;
  const prevOut = Number(prev.amountOut) || 0;

  const next: Record<string, string | number> = {};
  if (patch.date != null) next.date = patch.date;
  if (patch.description != null) next.description = patch.description.trim();
  if (patch.amountOut != null) next.amountOut = Number(patch.amountOut);
  if (patch.type != null) next.type = patch.type.trim();
  if (patch.receiptUrl != null) next.receiptUrl = patch.receiptUrl;
  if (patch.note != null) next.note = patch.note.trim();

  const nextOut = patch.amountOut != null ? Number(patch.amountOut) : prevOut;
  const nextDesc =
    patch.description != null ? patch.description.trim() : String(prev.description || "");
  validateOwnerPayload({ description: nextDesc, amountOut: nextOut });

  await updateDoc(entryRef, next);
  await applyOwnerOutDelta(nextOut - prevOut);
}

export async function importOwnerBookEntries(
  rows: ImportOwnerBookRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const db = getDb();
  const chunkSize = 400;
  let done = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const row of chunk) {
      const ref = doc(collection(db, "ownerBooks"));
      batch.set(ref, {
        date: row.date,
        description: row.description,
        amountIn: 0,
        amountOut: row.amountOut,
        type: row.type || "",
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        receiptUrl: "",
        note: "",
      });
    }
    await batch.commit();
    done += chunk.length;
    onProgress?.(done, rows.length);
  }

  await recomputeOwnerBooksTotal();
  return done;
}

export async function deleteAllOwnerBookEntries(
  onProgress?: (done: number) => void,
): Promise<number> {
  const db = getDb();
  let deleted = 0;
  for (;;) {
    const snap = await getDocs(
      query(collection(db, "ownerBooks"), orderBy("createdAt", "asc"), limit(400)),
    );
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.docs.length;
    onProgress?.(deleted);
    if (snap.docs.length < 400) break;
  }
  await setDoc(
    ownerBooksMetaRef(),
    { totalOut: 0, balance: 0, updatedAt: Date.now() },
    { merge: true },
  );
  return deleted;
}

export async function deleteOwnerBookEntry(id: string): Promise<void> {
  const entryRef = doc(getDb(), "ownerBooks", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) return;
  const prevOut = Number(prevSnap.data().amountOut) || 0;
  await deleteDoc(entryRef);
  await applyOwnerOutDelta(-prevOut);
}

/** Full scan for owner reports (P&L). */
export async function listOwnerBookEntries(): Promise<OwnerBookEntry[]> {
  const snap = await getDocs(
    query(ownerBooksCol(), orderBy("date", "asc"), orderBy("createdAt", "asc")),
  );
  return snap.docs.map(mapEntry);
}

/** Frequent descriptions for owner-book suggestion chips. */
export function frequentOwnerDescriptions(entries: OwnerBookEntry[], limitCount = 12): string[] {
  const map = new Map<string, { count: number; last: number }>();
  for (const e of entries) {
    const key = e.description.trim();
    if (!key || e.amountOut <= 0) continue;
    const cur = map.get(key) || { count: 0, last: 0 };
    cur.count += 1;
    cur.last = Math.max(cur.last, e.date || e.createdAt || 0);
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .slice(0, limitCount)
    .map(([k]) => k);
}
