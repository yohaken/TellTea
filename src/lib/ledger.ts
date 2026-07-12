import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentSnapshot,
  getAggregateFromServer,
  getDoc,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  sum,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { LedgerEntry, LedgerEntryInput } from "./types";
import type { ImportLedgerRow } from "./xlsx-import";

export const LEDGER_PAGE_SIZE = 60;
/** Cap live window so mobile stays light; scroll still grows up to this. */
export const LEDGER_LIVE_MAX = 480;

export type LedgerPage = {
  entries: LedgerEntry[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
  fromCache: boolean;
};

function mapEntry(d: QueryDocumentSnapshot): LedgerEntry {
  const data = d.data() as Omit<LedgerEntry, "id">;
  const createdAt = Number(data.createdAt) || 0;
  return {
    id: d.id,
    ...data,
    amountIn: Number(data.amountIn) || 0,
    amountOut: Number(data.amountOut) || 0,
    createdAt,
    updatedAt: Number(data.updatedAt) || createdAt,
  };
}

function toPage(docs: QueryDocumentSnapshot[], pageSize: number, fromCache: boolean): LedgerPage {
  return {
    entries: docs.map(mapEntry),
    cursor: docs.length ? docs[docs.length - 1]! : null,
    hasMore: docs.length >= pageSize,
    fromCache,
  };
}

function ledgerPageQuery(pageSize: number, after?: DocumentSnapshot | null) {
  const col = collection(getDb(), "ledger");
  return after
    ? query(
        col,
        orderBy("date", "desc"),
        orderBy("createdAt", "desc"),
        startAfter(after),
        limit(pageSize),
      )
    : query(col, orderBy("date", "desc"), orderBy("createdAt", "desc"), limit(pageSize));
}

function ledgerMetaRef() {
  return doc(getDb(), "meta", "ledger");
}

/** Prefer IndexedDB cache, then server — feels instant on repeat opens. */
export async function listLedgerPage(
  pageSize = LEDGER_PAGE_SIZE,
  after?: DocumentSnapshot | null,
  opts?: { preferCache?: boolean },
): Promise<LedgerPage> {
  const q = ledgerPageQuery(pageSize, after) as Query;
  const preferCache = opts?.preferCache !== false && !after;

  if (preferCache) {
    try {
      const cached = await getDocsFromCache(q);
      if (!cached.empty) {
        return toPage(cached.docs, pageSize, true);
      }
    } catch {
      // no local cache yet
    }
  }

  try {
    const snap = await getDocsFromServer(q);
    return toPage(snap.docs, pageSize, false);
  } catch {
    const snap = await getDocs(q);
    return toPage(snap.docs, pageSize, snap.metadata.fromCache);
  }
}

/**
 * Live newest-first window. Grows with `limitCount` (infinite scroll).
 * Cache hit first, then server pushes — no manual refresh.
 */
export function subscribeLedgerPage(
  limitCount: number,
  onPage: (page: LedgerPage) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const size = Math.max(1, Math.min(limitCount, LEDGER_LIVE_MAX));
  const q = ledgerPageQuery(size, null) as Query;
  return onSnapshot(
    q,
    (snap) => {
      onPage(toPage(snap.docs, size, snap.metadata.fromCache));
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

async function sumLedgerTotals(): Promise<{ totalIn: number; totalOut: number }> {
  try {
    const snap = await getAggregateFromServer(collection(getDb(), "ledger"), {
      totalIn: sum("amountIn"),
      totalOut: sum("amountOut"),
    });
    return {
      totalIn: Number(snap.data().totalIn) || 0,
      totalOut: Number(snap.data().totalOut) || 0,
    };
  } catch {
    // Aggregate can fail (field types / SDK) — fall back to chunked scan.
    let totalIn = 0;
    let totalOut = 0;
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      const constraints = cursor
        ? [orderBy("createdAt", "asc"), startAfter(cursor), limit(400)]
        : [orderBy("createdAt", "asc"), limit(400)];
      const snap = await getDocs(query(collection(getDb(), "ledger"), ...constraints));
      if (snap.empty) break;
      for (const d of snap.docs) {
        const data = d.data();
        totalIn += Number(data.amountIn) || 0;
        totalOut += Number(data.amountOut) || 0;
      }
      cursor = snap.docs[snap.docs.length - 1]!;
      if (snap.docs.length < 400) break;
    }
    return { totalIn, totalOut };
  }
}

/** Rebuild meta/ledger from all rows — durable source of truth for the UI. */
export async function recomputeLedgerBalance(): Promise<number> {
  const { totalIn, totalOut } = await sumLedgerTotals();
  const balance = totalIn - totalOut;
  await setDoc(
    ledgerMetaRef(),
    { balance, totalIn, totalOut, updatedAt: Date.now() },
    { merge: true },
  );
  return balance;
}

async function applyBalanceDelta(deltaIn: number, deltaOut: number): Promise<void> {
  const dIn = Number(deltaIn) || 0;
  const dOut = Number(deltaOut) || 0;
  if (dIn === 0 && dOut === 0) return;

  const ref = ledgerMetaRef();
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await recomputeLedgerBalance();
    return;
  }

  await setDoc(
    ref,
    {
      balance: increment(dIn - dOut),
      totalIn: increment(dIn),
      totalOut: increment(dOut),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

/**
 * Live cash balance from meta/ledger (updated on every write).
 * Bootstraps the meta doc once if missing.
 */
export function subscribeLedgerBalance(
  onBalance: (balance: number, fromCache: boolean) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let bootstrapping = false;

  return onSnapshot(
    ledgerMetaRef(),
    (snap) => {
      if (!snap.exists()) {
        if (bootstrapping) return;
        bootstrapping = true;
        void recomputeLedgerBalance()
          .then((balance) => onBalance(balance, false))
          .catch((err) => {
            onError?.(err instanceof Error ? err : new Error(String(err)));
          })
          .finally(() => {
            bootstrapping = false;
          });
        return;
      }
      const data = snap.data() as { balance?: unknown };
      const balance = Number(data.balance);
      onBalance(Number.isFinite(balance) ? balance : 0, snap.metadata.fromCache);
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

/** Read cached meta, or recompute. Prefer subscribeLedgerBalance in UI. */
export async function getLedgerBalance(): Promise<number> {
  try {
    const snap = await getDoc(ledgerMetaRef());
    if (snap.exists()) {
      const balance = Number(snap.data().balance);
      if (Number.isFinite(balance)) return balance;
    }
  } catch {
    // fall through
  }
  return recomputeLedgerBalance();
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
  const now = Date.now();
  const payload = {
    date: input.date,
    description: input.description.trim(),
    amountIn: Number(input.amountIn) || 0,
    amountOut: Number(input.amountOut) || 0,
    type: (input.type || "").trim(),
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    receiptUrl: input.receiptUrl || "",
  };
  validateLedgerPayload(payload);
  const ref = await addDoc(collection(getDb(), "ledger"), payload);
  await applyBalanceDelta(payload.amountIn, payload.amountOut);
  return ref.id;
}

export async function updateLedgerEntry(
  id: string,
  patch: Partial<
    Pick<LedgerEntry, "date" | "description" | "amountIn" | "amountOut" | "type" | "receiptUrl">
  >,
): Promise<void> {
  const entryRef = doc(getDb(), "ledger", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) throw new Error("ไม่พบรายการ");
  const prev = prevSnap.data() as LedgerEntry;
  const prevIn = Number(prev.amountIn) || 0;
  const prevOut = Number(prev.amountOut) || 0;

  const next: Record<string, string | number> = { updatedAt: Date.now() };
  if (patch.date != null) next.date = patch.date;
  if (patch.description != null) next.description = patch.description.trim();
  if (patch.amountIn != null) next.amountIn = Number(patch.amountIn);
  if (patch.amountOut != null) next.amountOut = Number(patch.amountOut);
  if (patch.type != null) next.type = patch.type;
  if (patch.receiptUrl != null) next.receiptUrl = patch.receiptUrl;

  const nextIn = next.amountIn != null ? Number(next.amountIn) : prevIn;
  const nextOut = next.amountOut != null ? Number(next.amountOut) : prevOut;

  if (next.amountIn != null && next.amountOut != null) {
    validateLedgerPayload({
      description: String(next.description ?? prev.description ?? "-"),
      amountIn: nextIn,
      amountOut: nextOut,
    });
  }
  await updateDoc(entryRef, next);
  await applyBalanceDelta(nextIn - prevIn, nextOut - prevOut);
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
        updatedAt: row.createdAt,
        receiptUrl: "",
      });
    }
    await batch.commit();
    done += chunk.length;
    onProgress?.(done, rows.length);
  }

  await recomputeLedgerBalance();
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
  await setDoc(
    ledgerMetaRef(),
    { balance: 0, totalIn: 0, totalOut: 0, updatedAt: Date.now() },
    { merge: true },
  );
  return deleted;
}

export async function deleteLedgerEntry(id: string): Promise<void> {
  const entryRef = doc(getDb(), "ledger", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) return;
  const prev = prevSnap.data() as LedgerEntry;
  await deleteDoc(entryRef);
  await applyBalanceDelta(-(Number(prev.amountIn) || 0), -(Number(prev.amountOut) || 0));
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
