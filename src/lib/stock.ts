import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { StockItem, StockItemInput } from "./types";

export async function listStockItems(): Promise<StockItem[]> {
  const snap = await getDocs(query(collection(getDb(), "stock"), orderBy("name", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockItem, "id">) }));
}

export async function createStockItem(input: StockItemInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("ต้องใส่ชื่อของ");
  const payload = {
    name,
    unit: (input.unit || "ชิ้น").trim(),
    qty: Number(input.qty) || 0,
    minQty: Number(input.minQty) || 0,
    note: (input.note || "").trim(),
    updatedAt: Date.now(),
    updatedBy: input.updatedBy,
  };
  const ref = await addDoc(collection(getDb(), "stock"), payload);
  return ref.id;
}

export async function adjustStockQty(
  id: string,
  delta: number,
  updatedBy: string,
): Promise<void> {
  const snap = await getDoc(doc(getDb(), "stock", id));
  if (!snap.exists()) throw new Error("ไม่พบรายการสต็อก");
  const item = snap.data() as Omit<StockItem, "id">;
  const next = Number(item.qty) + delta;
  if (next < 0) throw new Error("จำนวนคงเหลือติดลบไม่ได้");
  await updateDoc(doc(getDb(), "stock", id), {
    qty: next,
    updatedAt: Date.now(),
    updatedBy,
  });
}

export async function setStockQty(id: string, qty: number, updatedBy: string): Promise<void> {
  if (qty < 0) throw new Error("จำนวนต้องไม่ติดลบ");
  await updateDoc(doc(getDb(), "stock", id), {
    qty: Number(qty),
    updatedAt: Date.now(),
    updatedBy,
  });
}

export async function deleteStockItem(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "stock", id));
}
