import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  writeBatch,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { LedgerEntry, LedgerEntryInput } from "./types";
import type { ImportLedgerRow } from "./xlsx-import";

export async function listLedgerEntries(): Promise<LedgerEntry[]> {
  const snap = await getDocs(
    query(collection(getDb(), "ledger"), orderBy("date", "asc"), orderBy("createdAt", "asc")),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LedgerEntry, "id">) }));
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
  };
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
  const ref = await addDoc(collection(getDb(), "ledger"), payload);
  return ref.id;
}

/** Import many rows (xlsx). Batches of 400. */
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
