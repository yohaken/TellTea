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
  where,
  writeBatch,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  bangkokDateKey,
  normalizeAccountingDateKey,
  startOfLocalDay,
  toEpochMs,
} from "./utils";

export const CAPITAL_BOOKS_PAGE_SIZE = 60;
export const CAPITAL_BOOKS_LIVE_MAX = 480;
/** Max slip photos per capital-books row */
export const CAPITAL_BOOKS_RECEIPT_MAX = 6;

/** Seed marker — bump when historical seed rows change. */
export const CAPITAL_BOOKS_SEED_VERSION = 1;

export type CapitalBookEntry = {
  id: string;
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
  createdBy: string;
  createdAt: number;
  updatedAt?: number;
  receiptUrl?: string;
  receiptUrls?: string[];
  /** Stable key for idempotent seed rows */
  seedKey?: string;
};

export type CapitalBookEntryInput = {
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
  createdBy: string;
  receiptUrl?: string;
  receiptUrls?: string[];
  seedKey?: string;
};

export type CapitalBooksPage = {
  entries: CapitalBookEntry[];
  hasMore: boolean;
};

export type CapitalBooksSummary = {
  balance: number;
  totalIn: number;
  totalOut: number;
};

/** Normalize receiptUrls with legacy receiptUrl fallback. */
export function getCapitalBookReceiptUrls(
  entry?: Pick<CapitalBookEntry, "receiptUrl" | "receiptUrls"> | null,
): string[] {
  if (!entry) return [];
  if (Array.isArray(entry.receiptUrls) && entry.receiptUrls.length) {
    const urls = entry.receiptUrls.map(String).filter((u) => u.trim());
    if (urls.length) return urls.slice(0, CAPITAL_BOOKS_RECEIPT_MAX);
  }
  const legacy = (entry.receiptUrl || "").trim();
  return legacy ? [legacy] : [];
}

function normalizeReceiptFields(input: {
  receiptUrl?: string;
  receiptUrls?: string[];
}): { receiptUrl: string; receiptUrls: string[] } {
  const fromList = (input.receiptUrls || []).map((u) => u.trim()).filter(Boolean);
  const legacy = (input.receiptUrl || "").trim();
  const urls = (fromList.length ? fromList : legacy ? [legacy] : []).slice(
    0,
    CAPITAL_BOOKS_RECEIPT_MAX,
  );
  return { receiptUrl: urls[0] || "", receiptUrls: urls };
}

function mapEntry(d: QueryDocumentSnapshot): CapitalBookEntry {
  const data = d.data() as Omit<CapitalBookEntry, "id">;
  const createdAt = toEpochMs((data as { createdAt?: unknown }).createdAt);
  const amountIn = Number(data.amountIn) || 0;
  const amountOut = Number(data.amountOut) || 0;
  const { receiptUrl, receiptUrls } = normalizeReceiptFields({
    receiptUrl: data.receiptUrl,
    receiptUrls: data.receiptUrls,
  });
  return {
    id: d.id,
    date: (() => {
      const raw = toEpochMs((data as { date?: unknown }).date);
      if (!raw) return 0;
      const fixed = normalizeAccountingDateKey(bangkokDateKey(raw));
      if (fixed) return Date.parse(`${fixed}T00:00:00+07:00`);
      return startOfLocalDay(raw);
    })(),
    description: String(data.description || ""),
    amountIn,
    amountOut,
    createdBy: String(data.createdBy || ""),
    createdAt,
    updatedAt: toEpochMs((data as { updatedAt?: unknown }).updatedAt) || createdAt,
    receiptUrl,
    receiptUrls,
    seedKey: typeof data.seedKey === "string" ? data.seedKey : undefined,
  };
}

function capitalBooksCol() {
  return collection(getDb(), "capitalBooks");
}

function capitalMetaRef() {
  return doc(getDb(), "meta", "capitalBooks");
}

function bangkokMidnight(y: number, m: number, d: number): number {
  return Date.parse(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+07:00`,
  );
}

/** Historical capital rows (ลงทุน / คืนทุน) — used by ensureCapitalBooksSeeded. */
export const CAPITAL_BOOKS_SEED_ROWS: Array<{
  seedKey: string;
  date: number;
  description: string;
  amountIn: number;
  amountOut: number;
}> = [
  {
    seedKey: "invest-2024-03",
    date: bangkokMidnight(2024, 3, 1),
    description: "ลงทุน",
    amountIn: 450_000,
    amountOut: 0,
  },
  {
    seedKey: "return-2024-09-22",
    date: bangkokMidnight(2024, 9, 22),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 300_000,
  },
  {
    seedKey: "return-2024-10-22",
    date: bangkokMidnight(2024, 10, 22),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 100_000,
  },
  {
    seedKey: "return-2024-11-04",
    date: bangkokMidnight(2024, 11, 4),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 100_000,
  },
  {
    seedKey: "return-2024-12-09",
    date: bangkokMidnight(2024, 12, 9),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 100_000,
  },
  {
    seedKey: "return-2025-02-06",
    date: bangkokMidnight(2025, 2, 6),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 100_000,
  },
  {
    seedKey: "return-2025-11-12",
    date: bangkokMidnight(2025, 11, 12),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 500_000,
  },
  {
    seedKey: "return-2026-04-03",
    date: bangkokMidnight(2026, 4, 3),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 160_000,
  },
  {
    seedKey: "return-2026-05-05",
    date: bangkokMidnight(2026, 5, 5),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 100_000,
  },
  {
    seedKey: "return-2026-06-18",
    date: bangkokMidnight(2026, 6, 18),
    description: "คืนทุน",
    amountIn: 0,
    amountOut: 100_000,
  },
];

function validateCapitalPayload(payload: {
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

async function sumCapitalTotals(): Promise<{ totalIn: number; totalOut: number }> {
  let totalIn = 0;
  let totalOut = 0;
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const q = cursor
      ? query(
          capitalBooksCol(),
          orderBy("createdAt", "asc"),
          startAfter(cursor),
          limit(400),
        )
      : query(capitalBooksCol(), orderBy("createdAt", "asc"), limit(400));
    const snap = await getDocs(q);
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

export async function recomputeCapitalBooksSummary(): Promise<CapitalBooksSummary> {
  const { totalIn, totalOut } = await sumCapitalTotals();
  const balance = totalIn - totalOut;
  await setDoc(
    capitalMetaRef(),
    { balance, totalIn, totalOut, updatedAt: Date.now() },
    { merge: true },
  );
  return { balance, totalIn, totalOut };
}

async function applyBalanceDelta(deltaIn: number, deltaOut: number): Promise<void> {
  const dIn = Number(deltaIn) || 0;
  const dOut = Number(deltaOut) || 0;
  if (dIn === 0 && dOut === 0) return;

  const ref = capitalMetaRef();
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await recomputeCapitalBooksSummary();
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

export function subscribeCapitalBooksSummary(
  onSummary: (summary: CapitalBooksSummary, fromCache: boolean) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let bootstrapping = false;

  return onSnapshot(
    capitalMetaRef(),
    (snap) => {
      if (!snap.exists()) {
        if (bootstrapping) return;
        bootstrapping = true;
        void recomputeCapitalBooksSummary()
          .then((summary) => onSummary(summary, false))
          .catch((err) => {
            onError?.(err instanceof Error ? err : new Error(String(err)));
          })
          .finally(() => {
            bootstrapping = false;
          });
        return;
      }
      const data = snap.data() as {
        balance?: unknown;
        totalIn?: unknown;
        totalOut?: unknown;
      };
      const balance = Number(data.balance);
      const totalIn = Number(data.totalIn);
      const totalOut = Number(data.totalOut);
      onSummary(
        {
          balance: Number.isFinite(balance) ? balance : 0,
          totalIn: Number.isFinite(totalIn) ? totalIn : 0,
          totalOut: Number.isFinite(totalOut) ? totalOut : 0,
        },
        snap.metadata.fromCache,
      );
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

export function subscribeCapitalBooksPage(
  limitCount: number,
  onPage: (page: CapitalBooksPage) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const size = Math.max(1, Math.min(limitCount, CAPITAL_BOOKS_LIVE_MAX));
  const q = query(
    capitalBooksCol(),
    orderBy("date", "desc"),
    orderBy("createdAt", "desc"),
    limit(size),
  );
  return onSnapshot(
    q,
    (snap) => {
      onPage({
        entries: snap.docs.map(mapEntry),
        hasMore: snap.docs.length >= size,
      });
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );
}

export async function listCapitalBookEntries(): Promise<CapitalBookEntry[]> {
  const snap = await getDocs(
    query(capitalBooksCol(), orderBy("date", "asc"), orderBy("createdAt", "asc")),
  );
  return snap.docs.map(mapEntry);
}

export async function listCapitalBookEntriesSince(
  sinceMs: number,
): Promise<CapitalBookEntry[]> {
  const snap = await getDocs(
    query(
      capitalBooksCol(),
      where("date", ">=", sinceMs),
      orderBy("date", "asc"),
      orderBy("createdAt", "asc"),
    ),
  );
  return snap.docs.map(mapEntry);
}

export async function addCapitalBookEntry(
  input: CapitalBookEntryInput,
): Promise<string> {
  const now = Date.now();
  const { receiptUrl, receiptUrls } = normalizeReceiptFields(input);
  const amountIn = Number(input.amountIn) || 0;
  const amountOut = Number(input.amountOut) || 0;
  const payload = {
    date: startOfLocalDay(toEpochMs(input.date) || input.date),
    description: input.description.trim(),
    amountIn,
    amountOut,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    receiptUrl,
    receiptUrls,
    ...(input.seedKey ? { seedKey: input.seedKey } : {}),
  };
  validateCapitalPayload(payload);
  const ref = await addDoc(capitalBooksCol(), payload);
  await applyBalanceDelta(payload.amountIn, payload.amountOut);
  return ref.id;
}

export async function updateCapitalBookEntry(
  id: string,
  patch: Partial<
    Pick<
      CapitalBookEntry,
      "date" | "description" | "amountIn" | "amountOut" | "receiptUrl" | "receiptUrls"
    >
  >,
): Promise<void> {
  const entryRef = doc(getDb(), "capitalBooks", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) throw new Error("ไม่พบรายการ");
  const prev = prevSnap.data() as CapitalBookEntry;
  const prevIn = Number(prev.amountIn) || 0;
  const prevOut = Number(prev.amountOut) || 0;

  const next: Record<string, string | number | string[]> = {
    updatedAt: Date.now(),
  };
  if (patch.date != null) next.date = startOfLocalDay(toEpochMs(patch.date) || patch.date);
  if (patch.description != null) next.description = patch.description.trim();
  if (patch.amountIn != null) next.amountIn = Number(patch.amountIn);
  if (patch.amountOut != null) next.amountOut = Number(patch.amountOut);
  if (patch.receiptUrls != null || patch.receiptUrl != null) {
    const normalized =
      patch.receiptUrls != null
        ? normalizeReceiptFields({ receiptUrls: patch.receiptUrls })
        : normalizeReceiptFields({
            receiptUrl: patch.receiptUrl,
            receiptUrls: prev.receiptUrls,
          });
    next.receiptUrl = normalized.receiptUrl;
    next.receiptUrls = normalized.receiptUrls;
  }

  const nextIn = next.amountIn != null ? Number(next.amountIn) : prevIn;
  const nextOut = next.amountOut != null ? Number(next.amountOut) : prevOut;
  validateCapitalPayload({
    description: String(next.description ?? prev.description ?? "-"),
    amountIn: nextIn,
    amountOut: nextOut,
  });

  await updateDoc(entryRef, next);
  await applyBalanceDelta(nextIn - prevIn, nextOut - prevOut);
}

export async function deleteCapitalBookEntry(id: string): Promise<void> {
  const entryRef = doc(getDb(), "capitalBooks", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) return;
  const prev = prevSnap.data() as CapitalBookEntry;
  await deleteDoc(entryRef);
  await applyBalanceDelta(-(Number(prev.amountIn) || 0), -(Number(prev.amountOut) || 0));
}

/**
 * Idempotent historical seed for บช ทุน.
 * Skips seedKeys already present; marks meta.seedVersion when done.
 */
export async function ensureCapitalBooksSeeded(createdBy: string): Promise<number> {
  const metaSnap = await getDoc(capitalMetaRef());
  const seededVersion = Number(metaSnap.data()?.seedVersion) || 0;
  if (seededVersion >= CAPITAL_BOOKS_SEED_VERSION) return 0;

  const existingKeys = new Set<string>();
  // Small collection — scan once for seedKey collisions.
  const existingSnap = await getDocs(
    query(capitalBooksCol(), orderBy("createdAt", "asc"), limit(400)),
  );
  for (const d of existingSnap.docs) {
    const key = String(d.data().seedKey || "").trim();
    if (key) existingKeys.add(key);
  }

  const missing = CAPITAL_BOOKS_SEED_ROWS.filter((r) => !existingKeys.has(r.seedKey));
  if (missing.length) {
    const db = getDb();
    const batch = writeBatch(db);
    const now = Date.now();
    for (const row of missing) {
      const ref = doc(capitalBooksCol());
      batch.set(ref, {
        date: row.date,
        description: row.description,
        amountIn: row.amountIn,
        amountOut: row.amountOut,
        createdBy,
        createdAt: now,
        updatedAt: now,
        receiptUrl: "",
        receiptUrls: [],
        seedKey: row.seedKey,
      });
    }
    await batch.commit();
  }

  await recomputeCapitalBooksSummary();
  await setDoc(
    capitalMetaRef(),
    { seedVersion: CAPITAL_BOOKS_SEED_VERSION, updatedAt: Date.now() },
    { merge: true },
  );
  return missing.length;
}
