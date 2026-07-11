import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  writeBatch,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { LedgerEntry } from "./types";
import type { ImportOwnerBookRow } from "./xlsx-import";

export const OWNER_BOOKS_PAGE_SIZE = 60;
export const OWNER_BOOKS_LIVE_MAX = 480;

/** Same shape as ledger rows; amountIn is always 0 for owner books. */
export type OwnerBookEntry = LedgerEntry;

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
  };
}

function ownerBooksCol() {
  return collection(getDb(), "ownerBooks");
}

function ownerBooksMetaRef() {
  return doc(getDb(), "meta", "ownerBooks");
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
  await deleteDoc(doc(getDb(), "ownerBooks", id));
  await recomputeOwnerBooksTotal();
}
