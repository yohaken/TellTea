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
import {
  normalizePurchaseVat,
  normalizeVatSource,
  proposePurchaseVatInput,
  type EntryVatFields,
} from "./entry-vat";
import { getDb } from "./firebase";
import type { LedgerEntry } from "./types";
import { normalizeMoney, roundMoney } from "./vat-sales";
import type { ImportOwnerBookRow } from "./xlsx-import";

export const OWNER_BOOKS_PAGE_SIZE = 60;
export const OWNER_BOOKS_LIVE_MAX = 480;
/** Max slip photos per owner-books row */
export const OWNER_BOOKS_RECEIPT_MAX = 6;

/** Owner books row — out-only + optional note + ช่อง VAT (ภาษีซื้อ). */
export type OwnerBookEntry = LedgerEntry & {
  note?: string;
};

export type OwnerBookVatFields = EntryVatFields;

export type OwnerBookEntryInput = {
  date: number;
  description: string;
  amountOut: number;
  type: string;
  typeSource?: string;
  typeAiReason?: string;
  createdBy: string;
  receiptUrl?: string;
  receiptUrls?: string[];
  note?: string;
  hasVat?: boolean;
  vatInput?: number;
  vatBase?: number;
  vatInvoiceNo?: string;
  vatSource?: string;
  vatVerified?: boolean;
};

/** @deprecated ใช้ proposePurchaseVatInput จาก entry-vat */
export const proposeOwnerBookVatInput = proposePurchaseVatInput;
/** @deprecated ใช้ normalizePurchaseVat จาก entry-vat */
export const normalizeOwnerBookVat = normalizePurchaseVat;

export type OwnerBooksPage = {
  entries: OwnerBookEntry[];
  hasMore: boolean;
};

/** Normalize receiptUrls with legacy receiptUrl fallback. */
export function getOwnerBookReceiptUrls(
  entry?: Pick<OwnerBookEntry, "receiptUrl" | "receiptUrls"> | null,
): string[] {
  if (!entry) return [];
  if (Array.isArray(entry.receiptUrls) && entry.receiptUrls.length) {
    const urls = entry.receiptUrls.map(String).filter((u) => u.trim());
    if (urls.length) return urls.slice(0, OWNER_BOOKS_RECEIPT_MAX);
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
    OWNER_BOOKS_RECEIPT_MAX,
  );
  return { receiptUrl: urls[0] || "", receiptUrls: urls };
}

function mapEntry(d: QueryDocumentSnapshot): OwnerBookEntry {
  const data = d.data() as Omit<OwnerBookEntry, "id">;
  const createdAt = Number(data.createdAt) || 0;
  const amountOut = Number(data.amountOut) || 0;
  const { receiptUrl, receiptUrls } = normalizeReceiptFields({
    receiptUrl: data.receiptUrl,
    receiptUrls: data.receiptUrls,
  });
  const vat = normalizeOwnerBookVat(
    {
      hasVat: Boolean(data.hasVat),
      vatInput: Number(data.vatInput) || 0,
      vatBase: Number(data.vatBase) || 0,
      vatInvoiceNo:
        typeof data.vatInvoiceNo === "string" ? data.vatInvoiceNo : "",
      vatSource: normalizeVatSource(data.vatSource),
      vatVerified: Boolean(data.vatVerified),
    },
    amountOut,
  );
  return {
    id: d.id,
    ...data,
    amountIn: 0,
    amountOut,
    createdAt,
    updatedAt: Number(data.updatedAt) || createdAt,
    note: typeof data.note === "string" ? data.note : "",
    receiptUrl,
    receiptUrls,
    ...vat,
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
  const now = Date.now();
  const { receiptUrl, receiptUrls } = normalizeReceiptFields({
    receiptUrl: input.receiptUrl,
    receiptUrls: input.receiptUrls,
  });
  const amountOut = Number(input.amountOut) || 0;
  const vat = normalizeOwnerBookVat(
    {
      hasVat: Boolean(input.hasVat),
      vatInput: input.vatInput,
      vatBase: input.vatBase,
      vatInvoiceNo: input.vatInvoiceNo,
      vatSource: normalizeVatSource(input.vatSource),
      vatVerified: Boolean(input.vatVerified),
    },
    amountOut,
  );
  if (vat.hasVat && vat.vatInput <= 0) {
    throw new Error("มี VAT — ใส่ยอดภาษีซื้อจากบิล หรือกดใช้ประมาณ");
  }
  const payload = {
    date: input.date,
    description: input.description.trim(),
    amountIn: 0,
    amountOut,
    type: (input.type || "").trim(),
    typeSource: (input.typeSource || "").trim(),
    typeAiReason: (input.typeAiReason || "").trim(),
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    receiptUrl,
    receiptUrls,
    note: (input.note || "").trim(),
    hasVat: vat.hasVat,
    vatInput: vat.vatInput,
    vatBase: vat.vatBase,
    vatInvoiceNo: vat.vatInvoiceNo,
    vatSource: vat.vatSource,
    vatVerified: vat.vatVerified,
  };
  validateOwnerPayload(payload);
  const ref = await addDoc(ownerBooksCol(), payload);
  await applyOwnerOutDelta(payload.amountOut);
  return ref.id;
}

export async function updateOwnerBookEntry(
  id: string,
  patch: Partial<
    Pick<
      OwnerBookEntry,
      | "date"
      | "description"
      | "amountOut"
      | "type"
      | "typeSource"
      | "typeAiReason"
      | "receiptUrl"
      | "receiptUrls"
      | "note"
      | "hasVat"
      | "vatInput"
      | "vatBase"
      | "vatInvoiceNo"
      | "vatSource"
      | "vatVerified"
    >
  >,
): Promise<void> {
  const entryRef = doc(getDb(), "ownerBooks", id);
  const prevSnap = await getDoc(entryRef);
  if (!prevSnap.exists()) throw new Error("ไม่พบรายการ");
  const prev = prevSnap.data() as OwnerBookEntry;
  const prevOut = Number(prev.amountOut) || 0;

  const next: Record<string, string | number | boolean | string[]> = {
    updatedAt: Date.now(),
  };
  if (patch.date != null) next.date = patch.date;
  if (patch.description != null) next.description = patch.description.trim();
  if (patch.amountOut != null) next.amountOut = Number(patch.amountOut);
  if (patch.type != null) next.type = patch.type.trim();
  if (patch.typeSource != null) next.typeSource = String(patch.typeSource).trim();
  if (patch.typeAiReason != null) next.typeAiReason = String(patch.typeAiReason).trim();
  if (patch.receiptUrls != null || patch.receiptUrl != null) {
    const { receiptUrl, receiptUrls } = normalizeReceiptFields({
      receiptUrl: patch.receiptUrl,
      receiptUrls: patch.receiptUrls,
    });
    next.receiptUrl = receiptUrl;
    next.receiptUrls = receiptUrls;
  }
  if (patch.note != null) next.note = patch.note.trim();

  const nextOut = patch.amountOut != null ? Number(patch.amountOut) : prevOut;
  const nextDesc =
    patch.description != null ? patch.description.trim() : String(prev.description || "");
  validateOwnerPayload({ description: nextDesc, amountOut: nextOut });

  const vatTouched =
    patch.hasVat != null ||
    patch.vatInput != null ||
    patch.vatBase != null ||
    patch.vatInvoiceNo != null ||
    patch.vatSource != null ||
    patch.vatVerified != null ||
    patch.amountOut != null;
  if (vatTouched) {
    const vat = normalizeOwnerBookVat(
      {
        hasVat: patch.hasVat != null ? Boolean(patch.hasVat) : Boolean(prev.hasVat),
        vatInput:
          patch.vatInput != null ? patch.vatInput : Number(prev.vatInput) || 0,
        vatBase: patch.vatBase != null ? patch.vatBase : Number(prev.vatBase) || 0,
        vatInvoiceNo:
          patch.vatInvoiceNo != null
            ? patch.vatInvoiceNo
            : String(prev.vatInvoiceNo || ""),
        vatSource:
          patch.vatSource != null
            ? normalizeVatSource(patch.vatSource)
            : normalizeVatSource(prev.vatSource),
        vatVerified:
          patch.vatVerified != null
            ? Boolean(patch.vatVerified)
            : Boolean(prev.vatVerified),
      },
      nextOut,
    );
    if (vat.hasVat && vat.vatInput <= 0) {
      throw new Error("มี VAT — ใส่ยอดภาษีซื้อจากบิล หรือกดใช้ประมาณ");
    }
    next.hasVat = vat.hasVat;
    next.vatInput = vat.vatInput;
    next.vatBase = vat.vatBase;
    next.vatInvoiceNo = vat.vatInvoiceNo;
    next.vatSource = vat.vatSource;
    next.vatVerified = vat.vatVerified;
  }

  await updateDoc(entryRef, next);
  await applyOwnerOutDelta(nextOut - prevOut);
}

/** รวมภาษีซื้อจากรายการบช.เจ้าของที่มีติ๊ก VAT ในเดือน YYYY-MM */
export async function sumOwnerBooksVatInputByMonth(
  monthKey: string,
): Promise<{ vatInput: number; count: number }> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return { vatInput: 0, count: 0 };
  }
  const [ys, ms] = monthKey.split("-");
  const year = Number(ys);
  const month = Number(ms);
  if (!year || !month) return { vatInput: 0, count: 0 };
  const rows = await listOwnerBookEntriesInMonth(year, month);
  let vatInput = 0;
  let count = 0;
  for (const row of rows) {
    if (!row.hasVat) continue;
    const v = normalizeMoney(row.vatInput);
    if (v <= 0) continue;
    vatInput = roundMoney(vatInput + v);
    count += 1;
  }
  return { vatInput, count };
}

/** Bulk upsert type on many owner-books rows (owner-driven reclassify). */
export async function bulkUpdateOwnerBookTypes(
  ids: string[],
  type: string,
): Promise<number> {
  const nextType = String(type || "").trim();
  if (!nextType) throw new Error("เลือกประเภทก่อน");
  if (!ids.length) return 0;

  const db = getDb();
  let batch = writeBatch(db);
  let ops = 0;
  let count = 0;
  const now = Date.now();

  async function flush() {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  }

  for (const id of ids) {
    batch.update(doc(db, "ownerBooks", id), {
      type: nextType,
      typeSource: "owner",
      typeAiReason: "",
      updatedAt: now,
    });
    ops += 1;
    count += 1;
    if (ops >= 400) await flush();
  }
  await flush();
  return count;
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
        updatedAt: row.createdAt,
        receiptUrl: "",
        receiptUrls: [],
        note: row.note || "",
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

/** Full scan for export — อย่าใช้ตอนเปิดหน้าปกติ */
export async function listOwnerBookEntries(): Promise<OwnerBookEntry[]> {
  const snap = await getDocs(
    query(ownerBooksCol(), orderBy("date", "asc"), orderBy("createdAt", "asc")),
  );
  return snap.docs.map(mapEntry);
}

/** เดือนปฏิทิน — month = 1–12 (คู่กับ listLedgerEntriesInMonth) */
export async function listOwnerBookEntriesInMonth(
  year: number,
  month: number,
): Promise<OwnerBookEntry[]> {
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  const snap = await getDocs(
    query(
      ownerBooksCol(),
      where("date", ">=", start),
      where("date", "<", end),
      orderBy("date", "asc"),
      orderBy("createdAt", "asc"),
    ),
  );
  return snap.docs.map(mapEntry);
}

/** ช่วงวันที่ (until exclusive) — ใช้ P&L / ค้นหา */
export async function listOwnerBookEntriesSince(
  sinceMs: number,
  untilMs?: number,
): Promise<OwnerBookEntry[]> {
  const q =
    untilMs != null
      ? query(
          ownerBooksCol(),
          where("date", ">=", sinceMs),
          where("date", "<", untilMs),
          orderBy("date", "asc"),
          orderBy("createdAt", "asc"),
        )
      : query(
          ownerBooksCol(),
          where("date", ">=", sinceMs),
          orderBy("date", "asc"),
          orderBy("createdAt", "asc"),
        );
  const snap = await getDocs(q);
  return snap.docs.map(mapEntry);
}

/** Recent outs for suggestion chips — ไม่สแกนทั้งก้อน */
export async function listRecentOwnerBookEntries(max = 200): Promise<OwnerBookEntry[]> {
  const snap = await getDocs(
    query(
      ownerBooksCol(),
      orderBy("date", "desc"),
      orderBy("createdAt", "desc"),
      limit(max),
    ),
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
