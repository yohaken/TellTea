import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { DEFAULT_OT_BONUS_RATE, getOtSettings, saveOtSettings } from "./ot";
import { parseDateInput, todayInputValue } from "./utils";

/** ชนิดเรทที่กำหนดเป็นช่วงเวลาได้ */
export type RateKind = "ot" | "bakerySales" | "bakeryProd";

export const RATE_KIND_LABELS: Record<RateKind, string> = {
  ot: "เรทชง (บาท/หน่วย)",
  bakerySales: "เรทขายเบเกอรี่ (บาท/หน่วย)",
  bakeryProd: "เรทผลิต (บาท/หน่วย)",
};

export type RateScheduleEntry = {
  id: string;
  kind: RateKind;
  /** จำเป็นเมื่อ kind=bakeryProd — แยกเรทตามสินค้า */
  productId?: string;
  /** ชื่อสินค้าตอนบันทึก — โชว์ในประวัติ */
  productName?: string;
  /** วันเริ่มใช้ (local midnight ms) — ใช้เรื่อยๆ จนมีแถวใหม่ของชนิด+สินค้าเดียวกัน */
  effectiveFrom: number;
  /** ค่าเรท — ทศนิยมละเอียดได้ */
  rate: number;
  note?: string;
  createdAt: number;
  createdBy: string;
};

export type RateScheduleDoc = {
  entries: RateScheduleEntry[];
  updatedAt: number;
};

function scheduleRef() {
  return doc(getDb(), "meta", "rateSchedule");
}

function newEntryId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRateKind(v: unknown): v is RateKind {
  return v === "ot" || v === "bakerySales" || v === "bakeryProd";
}

export function normalizeRateSchedule(
  data: Partial<RateScheduleDoc> | undefined,
): RateScheduleDoc {
  const raw = Array.isArray(data?.entries) ? data!.entries! : [];
  const entries: RateScheduleEntry[] = [];
  for (const row of raw) {
    if (!row || !isRateKind(row.kind)) continue;
    const effectiveFrom = Number(row.effectiveFrom);
    const rate = Number(row.rate);
    if (!Number.isFinite(effectiveFrom) || !Number.isFinite(rate)) continue;
    const productId =
      row.kind === "bakeryProd" ? String(row.productId || "").trim() : undefined;
    if (row.kind === "bakeryProd" && !productId) continue;
    entries.push({
      id: String(row.id || newEntryId()),
      kind: row.kind,
      productId,
      productName:
        row.kind === "bakeryProd" && row.productName
          ? String(row.productName).slice(0, 80)
          : undefined,
      effectiveFrom,
      rate,
      note: row.note ? String(row.note).slice(0, 200) : undefined,
      createdAt: Number(row.createdAt) || 0,
      createdBy: String(row.createdBy || ""),
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    const ap = a.productName || a.productId || "";
    const bp = b.productName || b.productId || "";
    if (ap !== bp) return ap.localeCompare(bp, "th");
    return b.effectiveFrom - a.effectiveFrom || b.createdAt - a.createdAt;
  });
  return {
    entries,
    updatedAt: Number(data?.updatedAt) || 0,
  };
}

/**
 * เรทที่ใช้ ณ วันที่ — เลือกแถวล่าสุดที่ effectiveFrom ≤ dateMs
 * kind=bakeryProd ต้องส่ง productId
 * ไม่มีในตาราง → null (ให้ caller ใช้ fallback ของระบบเดิม)
 */
export function resolveRateForDate(
  entries: RateScheduleEntry[],
  kind: RateKind,
  dateMs: number,
  opts?: { productId?: string },
): RateScheduleEntry | null {
  const day = Number(dateMs) || 0;
  const productId = (opts?.productId || "").trim();
  let best: RateScheduleEntry | null = null;
  for (const row of entries) {
    if (row.kind !== kind) continue;
    if (kind === "bakeryProd") {
      if (!productId || row.productId !== productId) continue;
    }
    if (row.effectiveFrom > day) continue;
    if (
      !best ||
      row.effectiveFrom > best.effectiveFrom ||
      (row.effectiveFrom === best.effectiveFrom && row.createdAt > best.createdAt)
    ) {
      best = row;
    }
  }
  return best;
}

export function rateHistoryLabel(row: RateScheduleEntry): string {
  if (row.kind === "bakeryProd") {
    const name = row.productName || row.productId || "สินค้า";
    return `ผลิต · ${name}`;
  }
  if (row.kind === "ot") return "เรทชง";
  if (row.kind === "bakerySales") return "เรทขายเบเกอรี่";
  return RATE_KIND_LABELS[row.kind];
}

export function listRateHistory(
  entries: RateScheduleEntry[],
  kind?: RateKind,
  productId?: string,
): RateScheduleEntry[] {
  let rows = kind ? entries.filter((e) => e.kind === kind) : [...entries];
  if (productId) {
    rows = rows.filter((e) => e.productId === productId);
  }
  return rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    const ap = a.productName || a.productId || "";
    const bp = b.productName || b.productId || "";
    if (ap !== bp) return ap.localeCompare(bp, "th");
    return b.effectiveFrom - a.effectiveFrom || b.createdAt - a.createdAt;
  });
}

export async function getRateSchedule(): Promise<RateScheduleDoc> {
  const snap = await getDoc(scheduleRef());
  if (!snap.exists()) return { entries: [], updatedAt: 0 };
  return normalizeRateSchedule(snap.data() as Partial<RateScheduleDoc>);
}

export function subscribeRateSchedule(
  onDoc: (doc: RateScheduleDoc) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    scheduleRef(),
    (snap) => {
      if (!snap.exists()) {
        onDoc({ entries: [], updatedAt: 0 });
        return;
      }
      onDoc(normalizeRateSchedule(snap.data() as Partial<RateScheduleDoc>));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export type RateScheduleAddInput = {
  kind: RateKind;
  /** จำเป็นเมื่อ kind=bakeryProd */
  productId?: string;
  productName?: string;
  /** YYYY-MM-DD หรือค่าที่ parseDateInput รับได้ */
  effectiveFromInput: string;
  rate: number;
  note?: string;
  createdBy: string;
};

async function syncBakeryProdCatalog(
  entries: RateScheduleEntry[],
  productId: string,
): Promise<void> {
  const todayMs = parseDateInput(todayInputValue());
  const active = resolveRateForDate(entries, "bakeryProd", todayMs, { productId });
  if (!active) return;
  // dynamic import — เลี่ยงวงจร production ↔ rate-schedule
  const { updateProdProduct } = await import("./production");
  await updateProdProduct(productId, { prodRate: active.rate });
}

/**
 * เพิ่มช่วงเรทใหม่ — ไม่แก้แถวชง/ผลิตที่มีอยู่แล้ว
 * ถ้า kind=ot และวันเริ่ม ≤ วันนี้ → sync meta/otSettings
 * ถ้า kind=bakeryProd และวันเริ่ม ≤ วันนี้ → sync prodProducts.prodRate ของสินค้านั้น
 */
export async function addRateScheduleEntry(input: RateScheduleAddInput): Promise<RateScheduleDoc> {
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error("ใส่เรทให้ถูกต้อง (ตัวเลข ≥ 0)");
  }
  const effectiveFrom = parseDateInput(input.effectiveFromInput);
  if (!effectiveFrom) throw new Error("ใส่วันที่เริ่มใช้เรท");

  const productId =
    input.kind === "bakeryProd" ? String(input.productId || "").trim() : undefined;
  if (input.kind === "bakeryProd" && !productId) {
    throw new Error("เลือกสินค้าสำหรับเรทผลิต");
  }

  const current = await getRateSchedule();
  const nextEntry: RateScheduleEntry = {
    id: newEntryId(),
    kind: input.kind,
    productId,
    productName:
      input.kind === "bakeryProd"
        ? String(input.productName || "").trim().slice(0, 80) || undefined
        : undefined,
    effectiveFrom,
    rate,
    note: input.note?.trim() || undefined,
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };
  const next: RateScheduleDoc = {
    entries: normalizeRateSchedule({
      entries: [...current.entries, nextEntry],
      updatedAt: Date.now(),
    }).entries,
    updatedAt: Date.now(),
  };

  await setDoc(scheduleRef(), next, { merge: false });

  if (input.kind === "ot") {
    const todayMs = parseDateInput(todayInputValue());
    const active = resolveRateForDate(next.entries, "ot", todayMs);
    if (active) {
      await saveOtSettings(active.rate);
    }
  }

  if (input.kind === "bakeryProd" && productId) {
    const todayMs = parseDateInput(todayInputValue());
    const active = resolveRateForDate(next.entries, "bakeryProd", todayMs, { productId });
    if (active) {
      await syncBakeryProdCatalog(next.entries, productId);
    }
  }

  return next;
}

export async function deleteRateScheduleEntry(entryId: string): Promise<RateScheduleDoc> {
  const current = await getRateSchedule();
  const removed = current.entries.find((e) => e.id === entryId);
  const nextEntries = current.entries.filter((e) => e.id !== entryId);
  if (nextEntries.length === current.entries.length) {
    throw new Error("ไม่พบช่วงเรทนี้");
  }
  const next: RateScheduleDoc = {
    entries: nextEntries,
    updatedAt: Date.now(),
  };
  await setDoc(scheduleRef(), next, { merge: false });

  const todayMs = parseDateInput(todayInputValue());
  const activeOt = resolveRateForDate(next.entries, "ot", todayMs);
  if (activeOt) {
    await saveOtSettings(activeOt.rate);
  } else if (removed?.kind === "ot") {
    const settings = await getOtSettings();
    await saveOtSettings(settings.bonusRate || DEFAULT_OT_BONUS_RATE);
  }

  if (removed?.kind === "bakeryProd" && removed.productId) {
    await syncBakeryProdCatalog(next.entries, removed.productId);
  }

  return normalizeRateSchedule(next);
}

/**
 * เรทชงสำหรับรายการใหม่ ณ วันที่ — จากตารางช่วงเวลา แล้วค่อย fallback ตั้งค่าเดิม
 * รายการเก่าต้องใช้ entry.bonusRate ที่ติดแถวอยู่แล้วเท่านั้น
 */
export function resolveOtBonusRateForNewEntry(
  dateMs: number,
  schedule: RateScheduleEntry[],
  settingsFallback: number,
): number {
  const hit = resolveRateForDate(schedule, "ot", dateMs);
  if (hit) return hit.rate;
  const fb = Number(settingsFallback);
  return Number.isFinite(fb) && fb >= 0 ? fb : DEFAULT_OT_BONUS_RATE;
}

/**
 * เรทขายเบเกอรี่สำหรับรายการผลิตใหม่ — มีในตารางใช้ตามวัน ไม่มีใช้เรทสินค้า
 * รายการเก่าต้องใช้ entry.salesRate ที่ติดแถวอยู่แล้วเท่านั้น
 */
export function resolveBakerySalesRateForNewEntry(
  dateMs: number,
  schedule: RateScheduleEntry[],
  productSalesRate: number,
): number {
  const hit = resolveRateForDate(schedule, "bakerySales", dateMs);
  if (hit) return hit.rate;
  return Number(productSalesRate) || 0;
}

/**
 * เรทผลิตต่อสินค้าสำหรับรายการใหม่ — มีในตารางใช้ตามวัน ไม่มีใช้เรทในแคตตาล็อก
 * รายการเก่าต้องใช้ entry.prodRate ที่ติดแถวอยู่แล้วเท่านั้น
 */
export function resolveBakeryProdRateForNewEntry(
  dateMs: number,
  schedule: RateScheduleEntry[],
  productId: string,
  catalogProdRate: number,
): number {
  const hit = resolveRateForDate(schedule, "bakeryProd", dateMs, { productId });
  if (hit) return hit.rate;
  return Number(catalogProdRate) || 0;
}
