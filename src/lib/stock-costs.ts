/**
 * ต้นทุนวัตถุดิบ — แยกจาก stock (qty/ชื่อ)
 * อ่าน/เขียน: เจ้าของเท่านั้น
 */
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { StockItem } from "./types";

export type StockCostDoc = {
  unitCost: number;
  updatedAt: number;
};

function costRef(itemId: string) {
  return doc(getDb(), "stockCosts", itemId);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function getStockUnitCost(itemId: string): Promise<number> {
  const snap = await getDoc(costRef(itemId));
  if (!snap.exists()) return 0;
  return round2(Number(snap.data().unitCost) || 0);
}

export async function listStockCostMap(): Promise<Map<string, number>> {
  const snap = await getDocs(collection(getDb(), "stockCosts"));
  const map = new Map<string, number>();
  for (const d of snap.docs) {
    map.set(d.id, round2(Number(d.data().unitCost) || 0));
  }
  return map;
}

export async function setStockUnitCost(itemId: string, unitCost: number): Promise<void> {
  const n = Number(unitCost);
  const value = Number.isFinite(n) && n > 0 ? round2(n) : 0;
  if (value <= 0) {
    await setDoc(
      costRef(itemId),
      { unitCost: deleteField(), updatedAt: Date.now() },
      { merge: true },
    );
    return;
  }
  await setDoc(
    costRef(itemId),
    { unitCost: value, updatedAt: Date.now() } satisfies StockCostDoc,
    { merge: true },
  );
}

export function mergeStockCosts(items: StockItem[], costMap: Map<string, number>): StockItem[] {
  return items.map((item) => ({
    ...item,
    unitCost: costMap.get(item.id) ?? 0,
  }));
}

/** ย้าย unitCost จาก stock → stockCosts แล้วลบ field ออกจาก stock */
export async function migrateAllLegacyStockCosts(): Promise<number> {
  const snap = await getDocs(collection(getDb(), "stock"));
  let n = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const legacy = Number(data.unitCost) || 0;
    if (!(legacy > 0) && data.unitCost == null) continue;
    const existing = await getStockUnitCost(d.id);
    if (!(existing > 0) && legacy > 0) {
      await setStockUnitCost(d.id, legacy);
    }
    try {
      await updateDoc(doc(getDb(), "stock", d.id), {
        unitCost: deleteField(),
        updatedAt: Date.now(),
      });
      n += 1;
    } catch {
      /* may already be stripped or no write */
    }
  }
  return n;
}
