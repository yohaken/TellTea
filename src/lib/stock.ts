import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import {
  listStockCostMap,
  mergeStockCosts,
  migrateAllLegacyStockCosts,
  setStockUnitCost,
} from "./stock-costs";
import { getDb } from "./firebase";
import { startOfLocalDay } from "./utils";
import type {
  StockItem,
  StockItemInput,
  StockMovement,
  StockMovementInput,
  StockMovementType,
} from "./types";

export { migrateAllLegacyStockCosts };

const STOCK_COL = "stock";
const MOVEMENTS_COL = "stockMovements";

export const DEFAULT_STOCK_ITEMS: Omit<
  StockItemInput,
  "updatedBy"
>[] = [
  { name: "ถุงเก็บความเย็น", unit: "ถุง", qty: 0, minQty: 50, safetyStock: 20, unitCost: 0 },
  { name: "ถุงกระดาษเบเกอรี่", unit: "ถุง", qty: 0, minQty: 100, safetyStock: 30, unitCost: 0 },
  { name: "แก้วชา", unit: "ใบ", qty: 0, minQty: 200, safetyStock: 50, unitCost: 0 },
  { name: "หลอดใหญ่", unit: "หลอด", qty: 0, minQty: 500, safetyStock: 100, unitCost: 0 },
  { name: "หลอดเล็ก 0.5 มล", unit: "หลอด", qty: 0, minQty: 500, safetyStock: 100, unitCost: 0 },
  { name: "ฝาซีล", unit: "ฝา", qty: 0, minQty: 300, safetyStock: 80, unitCost: 0 },
  { name: "โซดา", unit: "กระป๋อง", qty: 0, minQty: 24, safetyStock: 12, unitCost: 0 },
  { name: "โคน S", unit: "โคน", qty: 0, minQty: 30, safetyStock: 10, unitCost: 0 },
  { name: "โคน M", unit: "โคน", qty: 0, minQty: 30, safetyStock: 10, unitCost: 0 },
  { name: "โคน L", unit: "โคน", qty: 0, minQty: 30, safetyStock: 10, unitCost: 0 },
  { name: "IC.นม", unit: "ถุง", qty: 0, minQty: 20, safetyStock: 8, unitCost: 0 },
  { name: "IC.รสอื่นๆ", unit: "ถุง", qty: 0, minQty: 20, safetyStock: 8, unitCost: 0 },
];

function mapStockDoc(id: string, data: Record<string, unknown>): StockItem {
  return {
    id,
    name: String(data.name || ""),
    unit: String(data.unit || "ชิ้น"),
    qty: Number(data.qty) || 0,
    minQty: Number(data.minQty) || 0,
    safetyStock: Number(data.safetyStock) || 0,
    // ต้นทุนอยู่ stockCosts — ไม่อ่านจาก stock (กัน leak ระหว่าง migrate)
    unitCost: 0,
    barcode: data.barcode ? String(data.barcode) : undefined,
    note: data.note ? String(data.note) : undefined,
    updatedAt: Number(data.updatedAt) || 0,
    updatedBy: String(data.updatedBy || ""),
  };
}

/** @deprecated stock docs ไม่มี unitCost แล้ว — คงไว้เพื่อ call site เก่า */
export function redactStockUnitCosts(items: StockItem[]): StockItem[] {
  return items.map((item) => (item.unitCost ? { ...item, unitCost: 0 } : item));
}

function mapMovementDoc(id: string, data: Record<string, unknown>): StockMovement {
  return {
    id,
    itemId: String(data.itemId || ""),
    itemName: String(data.itemName || ""),
    type: data.type as StockMovementType,
    quantity: Number(data.quantity) || 0,
    qtyBefore: data.qtyBefore != null ? Number(data.qtyBefore) : undefined,
    qtyAfter: data.qtyAfter != null ? Number(data.qtyAfter) : undefined,
    date: Number(data.date) || 0,
    inspector: String(data.inspector || ""),
    remark: String(data.remark || ""),
    createdAt: Number(data.createdAt) || 0,
    createdBy: String(data.createdBy || ""),
  };
}

function stockPayload(input: StockItemInput, opts?: { stripUnitCost?: boolean }) {
  const name = input.name.trim();
  if (!name) throw new Error("ต้องใส่ชื่อวัตถุดิบ");
  const base: Record<string, unknown> = {
    name,
    unit: (input.unit || "ชิ้น").trim(),
    qty: Number(input.qty) || 0,
    minQty: Number(input.minQty) || 0,
    safetyStock: Number(input.safetyStock) || 0,
    barcode: (input.barcode || "").trim() || null,
    note: (input.note || "").trim(),
    updatedAt: Date.now(),
    updatedBy: input.updatedBy,
  };
  // อัปเดต: ลบ legacy unitCost ออกจาก stock doc
  if (opts?.stripUnitCost) base.unitCost = deleteField();
  return base;
}

export async function listStockItems(): Promise<StockItem[]> {
  const snap = await getDocs(query(collection(getDb(), STOCK_COL), orderBy("name", "asc")));
  return snap.docs.map((d) => mapStockDoc(d.id, d.data() as Record<string, unknown>));
}

/** รายการ + ต้นทุน (เจ้าของ) */
export async function listStockItemsWithCosts(): Promise<StockItem[]> {
  const [items, costMap] = await Promise.all([listStockItems(), listStockCostMap()]);
  return mergeStockCosts(items, costMap);
}

export function subscribeStockItems(
  onData: (items: StockItem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(getDb(), STOCK_COL), orderBy("name", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapStockDoc(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err),
  );
}

/** subscribe พร้อมต้นทุน — ใช้เฉพาะเจ้าของ (rules บล็อก stockCosts สำหรับ staff) */
export function subscribeStockItemsWithCosts(
  onData: (items: StockItem[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  let roster: StockItem[] = [];
  let costMap = new Map<string, number>();
  const emit = () => onData(mergeStockCosts(roster, costMap));

  const unsubStock = onSnapshot(
    query(collection(getDb(), STOCK_COL), orderBy("name", "asc")),
    (snap) => {
      roster = snap.docs.map((d) => mapStockDoc(d.id, d.data() as Record<string, unknown>));
      emit();
    },
    (err) => onError?.(err),
  );
  const unsubCosts = onSnapshot(
    collection(getDb(), "stockCosts"),
    (snap) => {
      costMap = new Map(
        snap.docs.map((d) => [d.id, Math.round((Number(d.data().unitCost) || 0) * 100) / 100]),
      );
      emit();
    },
    (err) => onError?.(err),
  );
  return () => {
    unsubStock();
    unsubCosts();
  };
}

export function subscribeStockMovements(
  onData: (rows: StockMovement[]) => void,
  onError?: (err: Error) => void,
  opts?: { itemId?: string; since?: number },
): Unsubscribe {
  let q = query(collection(getDb(), MOVEMENTS_COL), orderBy("date", "desc"), orderBy("createdAt", "desc"));
  if (opts?.itemId) {
    q = query(
      collection(getDb(), MOVEMENTS_COL),
      where("itemId", "==", opts.itemId),
      orderBy("date", "desc"),
      orderBy("createdAt", "desc"),
    );
  } else if (opts?.since) {
    q = query(
      collection(getDb(), MOVEMENTS_COL),
      where("date", ">=", opts.since),
      orderBy("date", "desc"),
      orderBy("createdAt", "desc"),
    );
  }
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapMovementDoc(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err),
  );
}

async function applyMovement(input: StockMovementInput): Promise<void> {
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("จำนวนต้องมากกว่า 0");

  const db = getDb();
  const itemRef = doc(db, STOCK_COL, input.itemId);
  const movementRef = doc(collection(db, MOVEMENTS_COL));

  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("ไม่พบรายการสต๊อก");
    const item = mapStockDoc(itemSnap.id, itemSnap.data() as Record<string, unknown>);
    const before = item.qty;
    let after = before;

    if (input.type === "IN") after = before + qty;
    else if (input.type === "OUT") {
      after = before - qty;
      if (after < 0) throw new Error("จำนวนคงเหลือไม่พอ");
    } else if (input.type === "ADJUST") {
      after = input.qtyAfter != null ? Number(input.qtyAfter) : before;
      if (after < 0) throw new Error("ยอดหลังปรับต้องไม่ติดลบ");
    }

    tx.update(itemRef, {
      qty: after,
      updatedAt: Date.now(),
      updatedBy: input.createdBy,
    });

    tx.set(movementRef, {
      itemId: input.itemId,
      itemName: input.itemName,
      type: input.type,
      quantity: input.type === "ADJUST" ? Math.abs(after - before) : qty,
      qtyBefore: before,
      qtyAfter: after,
      date: input.date,
      inspector: input.inspector,
      remark: (input.remark || "").trim(),
      createdAt: Date.now(),
      createdBy: input.createdBy,
    });
  });
}

export async function recordStockIn(
  itemId: string,
  itemName: string,
  quantity: number,
  inspector: string,
  createdBy: string,
  remark = "",
): Promise<void> {
  await applyMovement({
    itemId,
    itemName,
    type: "IN",
    quantity,
    date: startOfLocalDay(),
    inspector,
    remark: remark || "รับเข้าจากซัพพลายเออร์",
    createdBy,
  });
}

export async function recordStockOut(
  itemId: string,
  itemName: string,
  quantity: number,
  inspector: string,
  createdBy: string,
  remark = "",
): Promise<void> {
  await applyMovement({
    itemId,
    itemName,
    type: "OUT",
    quantity,
    date: startOfLocalDay(),
    inspector,
    remark: remark || "เบิกใช้หน้าร้าน",
    createdBy,
  });
}

export async function recordCycleCount(
  itemId: string,
  itemName: string,
  countedQty: number,
  systemQty: number,
  inspector: string,
  createdBy: string,
): Promise<{ adjusted: boolean; delta: number }> {
  const counted = Number(countedQty);
  if (!Number.isFinite(counted) || counted < 0) throw new Error("ยอดนับต้องไม่ติดลบ");
  const delta = counted - systemQty;
  if (delta === 0) return { adjusted: false, delta: 0 };

  await applyMovement({
    itemId,
    itemName,
    type: "ADJUST",
    quantity: Math.abs(delta),
    qtyAfter: counted,
    date: startOfLocalDay(),
    inspector,
    remark: `Cycle count: ระบบ ${systemQty} → นับได้ ${counted}`,
    createdBy,
  });
  return { adjusted: true, delta };
}

export async function createStockItem(input: StockItemInput): Promise<string> {
  const ref = await addDoc(collection(getDb(), STOCK_COL), stockPayload(input));
  if (input.unitCost != null && Number(input.unitCost) > 0) {
    await setStockUnitCost(ref.id, Number(input.unitCost));
  }
  return ref.id;
}

export async function updateStockItem(
  id: string,
  patch: Partial<StockItemInput> & { updatedBy: string },
): Promise<void> {
  const snap = await getDoc(doc(getDb(), STOCK_COL, id));
  if (!snap.exists()) throw new Error("ไม่พบรายการ");
  const current = mapStockDoc(snap.id, snap.data() as Record<string, unknown>);
  const merged: StockItemInput = {
    name: patch.name ?? current.name,
    unit: patch.unit ?? current.unit,
    qty: patch.qty ?? current.qty,
    minQty: patch.minQty ?? current.minQty,
    safetyStock: patch.safetyStock ?? current.safetyStock,
    barcode: patch.barcode ?? current.barcode,
    note: patch.note ?? current.note,
    updatedBy: patch.updatedBy,
  };
  await updateDoc(doc(getDb(), STOCK_COL, id), stockPayload(merged, { stripUnitCost: true }));
  if (patch.unitCost !== undefined) {
    await setStockUnitCost(id, Number(patch.unitCost) || 0);
  }
}

/** @deprecated use recordStockIn/Out — kept for compatibility */
export async function adjustStockQty(id: string, delta: number, updatedBy: string): Promise<void> {
  const snap = await getDoc(doc(getDb(), STOCK_COL, id));
  if (!snap.exists()) throw new Error("ไม่พบรายการสต็อก");
  const item = mapStockDoc(snap.id, snap.data() as Record<string, unknown>);
  if (delta > 0) {
    await recordStockIn(id, item.name, delta, updatedBy, updatedBy, "ปรับด้วยปุ่ม +/-");
  } else if (delta < 0) {
    await recordStockOut(id, item.name, Math.abs(delta), updatedBy, updatedBy, "ปรับด้วยปุ่ม +/-");
  }
}

export async function setStockQty(id: string, qty: number, updatedBy: string): Promise<void> {
  const snap = await getDoc(doc(getDb(), STOCK_COL, id));
  if (!snap.exists()) throw new Error("ไม่พบรายการสต็อก");
  const item = mapStockDoc(snap.id, snap.data() as Record<string, unknown>);
  await recordCycleCount(id, item.name, qty, item.qty, updatedBy, updatedBy);
}

export async function deleteStockItem(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), STOCK_COL, id));
  try {
    await deleteDoc(doc(getDb(), "stockCosts", id));
  } catch {
    /* cost doc may not exist */
  }
}

export async function seedStockItemsIfEmpty(updatedBy: string): Promise<boolean> {
  const snap = await getDocs(query(collection(getDb(), STOCK_COL), limit(1)));
  if (!snap.empty) return false;
  for (const item of DEFAULT_STOCK_ITEMS) {
    await createStockItem({ ...item, updatedBy });
  }
  return true;
}

export function findStockByBarcode(items: StockItem[], code: string): StockItem | undefined {
  const normalized = code.trim();
  if (!normalized) return undefined;
  return (
    items.find((i) => i.barcode === normalized) ||
    items.find((i) => i.name.toLowerCase().includes(normalized.toLowerCase()))
  );
}

export type UsageTrendPoint = { label: string; total: number };

export type ItemUsageTrend = {
  itemId: string;
  itemName: string;
  unit: string;
  daily: UsageTrendPoint[];
  weekly: UsageTrendPoint[];
};

function bucketKey(ms: number, mode: "day" | "week"): string {
  const d = new Date(ms);
  if (mode === "day") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return `W${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function formatBucketLabel(key: string, mode: "day" | "week"): string {
  if (mode === "week") return key.replace("W", "สัปดาห์ ");
  const [, m, day] = key.split("-");
  return `${Number(day)}/${Number(m)}`;
}

export function computeUsageTrends(
  items: StockItem[],
  movements: StockMovement[],
  days = 14,
): ItemUsageTrend[] {
  const since = startOfLocalDay(new Date(Date.now() - days * 86400000));
  const outMoves = movements.filter((m) => m.type === "OUT" && m.date >= since);

  return items.map((item) => {
    const mine = outMoves.filter((m) => m.itemId === item.id);
    const dailyMap = new Map<string, number>();
    const weeklyMap = new Map<string, number>();
    for (const m of mine) {
      const dk = bucketKey(m.date, "day");
      const wk = bucketKey(m.date, "week");
      dailyMap.set(dk, (dailyMap.get(dk) || 0) + m.quantity);
      weeklyMap.set(wk, (weeklyMap.get(wk) || 0) + m.quantity);
    }
    const dailyKeys = [...dailyMap.keys()].sort();
    const weeklyKeys = [...weeklyMap.keys()].sort();
    return {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      daily: dailyKeys.map((k) => ({ label: formatBucketLabel(k, "day"), total: dailyMap.get(k) || 0 })),
      weekly: weeklyKeys.map((k) => ({ label: formatBucketLabel(k, "week"), total: weeklyMap.get(k) || 0 })),
    };
  });
}

export function totalStockValue(items: StockItem[]): number {
  return items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
}

export function criticalStockItems(items: StockItem[]): StockItem[] {
  return items.filter((i) => i.minQty > 0 && i.qty < i.minQty);
}

/** Pick random item for daily cycle count — prefer items not ADJUST-counted today */
export function pickCycleCountItem(
  items: StockItem[],
  movements: StockMovement[],
  today = startOfLocalDay(),
): StockItem | null {
  if (items.length === 0) return null;
  const countedToday = new Set(
    movements
      .filter(
        (m) =>
          m.type === "ADJUST" &&
          m.date >= today &&
          m.remark.startsWith("Cycle count:"),
      )
      .map((m) => m.itemId),
  );
  const pool = items.filter((i) => !countedToday.has(i.id));
  const source = pool.length > 0 ? pool : items;
  return source[Math.floor(Math.random() * source.length)] ?? null;
}
