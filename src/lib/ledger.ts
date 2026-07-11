import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { LedgerEntry, LedgerEntryInput } from "./types";

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
