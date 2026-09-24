/**
 * ต้นทุนวัตถุดิบ — แยกจาก stock (qty/ชื่อ)
 * อ่าน/เขียน: เจ้าของเท่านั้น (firestore.rules · stockCosts / stockCostHistory)
 */
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { StockItem } from "./types";

export type StockCostDoc = {
  unitCost: number;
  updatedAt: number;
  /** บิล ledger ที่ใช้อัปเดตล่าสุด */
  sourceLedgerId?: string | null;
  sourceBillLine?: string | null;
  baseUnit?: string | null;
};

export type StockCostHistoryRow = {
  id: string;
  itemId: string;
  unitCost: number;
  baseUnit: string;
  at: number;
  by: string;
  ledgerEntryId?: string;
  billLineName?: string;
  note?: string;
};

export type SetStockUnitCostOpts = {
  updatedBy?: string;
  ledgerEntryId?: string | null;
  billLineName?: string | null;
  baseUnit?: string | null;
  note?: string | null;
  /** ข้าม history ถ้าค่าไม่เปลี่ยน */
  skipIfUnchanged?: boolean;
};

const HISTORY_COL = "stockCostHistory";

function costRef(itemId: string) {
  return doc(getDb(), "stockCosts", itemId);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function mapCostDoc(data: Record<string, unknown>): StockCostDoc {
  return {
    unitCost: round2(Number(data.unitCost) || 0),
    updatedAt: Number(data.updatedAt) || 0,
    sourceLedgerId: data.sourceLedgerId ? String(data.sourceLedgerId) : null,
    sourceBillLine: data.sourceBillLine ? String(data.sourceBillLine) : null,
    baseUnit: data.baseUnit ? String(data.baseUnit) : null,
  };
}

export async function getStockUnitCost(itemId: string): Promise<number> {
  const snap = await getDoc(costRef(itemId));
  if (!snap.exists()) return 0;
  return round2(Number(snap.data().unitCost) || 0);
}

export async function getStockCostDoc(itemId: string): Promise<StockCostDoc | null> {
  const snap = await getDoc(costRef(itemId));
  if (!snap.exists()) return null;
  return mapCostDoc(snap.data() as Record<string, unknown>);
}

export async function listStockCostMap(): Promise<Map<string, number>> {
  const snap = await getDocs(collection(getDb(), "stockCosts"));
  const map = new Map<string, number>();
  for (const d of snap.docs) {
    map.set(d.id, round2(Number(d.data().unitCost) || 0));
  }
  return map;
}

/** map itemId → meta ต้นทุน (วันที่ + ลิงก์บิล) */
export async function listStockCostMetaMap(): Promise<Map<string, StockCostDoc>> {
  const snap = await getDocs(collection(getDb(), "stockCosts"));
  const map = new Map<string, StockCostDoc>();
  for (const d of snap.docs) {
    map.set(d.id, mapCostDoc(d.data() as Record<string, unknown>));
  }
  return map;
}

export function subscribeStockCostMetaMap(
  onData: (map: Map<string, StockCostDoc>) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getDb(), "stockCosts"),
    (snap) => {
      const map = new Map<string, StockCostDoc>();
      for (const d of snap.docs) {
        map.set(d.id, mapCostDoc(d.data() as Record<string, unknown>));
      }
      onData(map);
    },
    (err) => {
      const code = (err as { code?: string })?.code || "";
      const msg = err?.message || "";
      if (
        code === "permission-denied" ||
        /insufficient permissions|permission-denied/i.test(msg)
      ) {
        onData(new Map());
        return;
      }
      onError?.(err);
    },
  );
}

export async function setStockUnitCost(
  itemId: string,
  unitCost: number,
  opts?: SetStockUnitCostOpts,
): Promise<void> {
  const n = Number(unitCost);
  const value = Number.isFinite(n) && n > 0 ? round2(n) : 0;
  const now = Date.now();
  const by = String(opts?.updatedBy || "").trim();

  if (value <= 0) {
    await setDoc(
      costRef(itemId),
      {
        unitCost: deleteField(),
        updatedAt: now,
        sourceLedgerId: deleteField(),
        sourceBillLine: deleteField(),
        baseUnit: deleteField(),
      },
      { merge: true },
    );
    return;
  }

  if (opts?.skipIfUnchanged) {
    const prev = await getStockCostDoc(itemId);
    if (prev && prev.unitCost === value) return;
  }

  const payload: Record<string, unknown> = {
    unitCost: value,
    updatedAt: now,
  };
  if (opts?.ledgerEntryId !== undefined) {
    payload.sourceLedgerId = opts.ledgerEntryId ? String(opts.ledgerEntryId) : null;
  }
  if (opts?.billLineName !== undefined) {
    payload.sourceBillLine = opts.billLineName ? String(opts.billLineName).slice(0, 120) : null;
  }
  if (opts?.baseUnit !== undefined) {
    payload.baseUnit = opts.baseUnit ? String(opts.baseUnit).slice(0, 20) : null;
  }

  await setDoc(costRef(itemId), payload, { merge: true });

  await addDoc(collection(getDb(), HISTORY_COL), {
    itemId,
    unitCost: value,
    baseUnit: String(opts?.baseUnit || "ก.").slice(0, 20),
    at: now,
    by: by || "owner",
    ledgerEntryId: opts?.ledgerEntryId ? String(opts.ledgerEntryId) : null,
    billLineName: opts?.billLineName ? String(opts.billLineName).slice(0, 120) : null,
    note: opts?.note ? String(opts.note).slice(0, 160) : null,
  });
}

export async function listStockCostHistory(
  itemId: string,
  max = 10,
): Promise<StockCostHistoryRow[]> {
  const snap = await getDocs(
    query(collection(getDb(), HISTORY_COL), where("itemId", "==", itemId), limit(40)),
  );
  const rows = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      itemId: String(data.itemId || itemId),
      unitCost: round2(Number(data.unitCost) || 0),
      baseUnit: String(data.baseUnit || "ก."),
      at: Number(data.at) || 0,
      by: String(data.by || ""),
      ledgerEntryId: data.ledgerEntryId ? String(data.ledgerEntryId) : undefined,
      billLineName: data.billLineName ? String(data.billLineName) : undefined,
      note: data.note ? String(data.note) : undefined,
    };
  });
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, Math.min(40, Math.max(1, max)));
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
      await setStockUnitCost(d.id, legacy, { note: "migrate legacy stock.unitCost" });
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

/** หน่วยเข้าชุดเดียวกันไหม (ก./กก. · มล./ล. · ชิ้น) */
export function stockUnitsCompatible(a: string, b: string): boolean {
  const norm = (u: string) =>
    String(u || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return true;
  if (x === y) return true;
  const mass = new Set([
    "ก.",
    "ก",
    "g",
    "กรัม",
    "gram",
    "grams",
    "kg",
    "กก.",
    "กก",
    "กิโล",
    "กิโลกรัม",
  ]);
  const vol = new Set([
    "มล.",
    "มล",
    "ml",
    "มิลลิลิตร",
    "ล.",
    "ล",
    "ลิตร",
    "l",
    "liter",
    "litre",
  ]);
  const piece = new Set([
    "ชิ้น",
    "ถุง",
    "ซอง",
    "อัน",
    "ลูก",
    "ฟอง",
    "โคน",
    "ใบ",
    "หลอด",
    "ฝา",
  ]);
  const inMass = mass.has(x) && mass.has(y);
  const inVol = vol.has(x) && vol.has(y);
  const inPiece = piece.has(x) && piece.has(y);
  return inMass || inVol || inPiece;
}

/** แปลงราคาต่อหน่วยเมื่อหน่วยต่างกันในชุดเดียวกัน (เช่น กก. → ก.) */
export function convertUnitCost(
  unitCost: number,
  fromUnit: string,
  toUnit: string,
): number | null {
  if (!(unitCost > 0)) return null;
  if (!stockUnitsCompatible(fromUnit, toUnit)) return null;
  const norm = (u: string) =>
    String(u || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  const from = norm(fromUnit);
  const to = norm(toUnit);
  if (from === to) return round2(unitCost);
  const toGram = new Set(["ก.", "ก", "g", "กรัม", "gram", "grams"]);
  const toKg = new Set(["กก.", "กก", "kg", "กิโล", "กิโลกรัม"]);
  const toMl = new Set(["มล.", "มล", "ml", "มิลลิลิตร"]);
  const toL = new Set(["ล.", "ล", "ลิตร", "l", "liter", "litre"]);
  // กก. → ก. : ราคา/กก. ÷ 1000 = ราคา/ก.
  if (toKg.has(from) && toGram.has(to)) {
    return Math.round((unitCost / 1000) * 100000) / 100000;
  }
  if (toGram.has(from) && toKg.has(to)) {
    return round2(unitCost * 1000);
  }
  if (toL.has(from) && toMl.has(to)) {
    return Math.round((unitCost / 1000) * 100000) / 100000;
  }
  if (toMl.has(from) && toL.has(to)) {
    return round2(unitCost * 1000);
  }
  return round2(unitCost);
}
