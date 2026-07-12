import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type OtStatus = "unpaid" | "pending" | "paid";

export type OtShiftId = "late" | "morning" | "evening";

export const OT_SHIFTS: { id: OtShiftId; label: string }[] = [
  { id: "late", label: "ดึก 0.3–7" },
  { id: "morning", label: "เช้า 7–17" },
  { id: "evening", label: "เย็น 17–0.3" },
];

export const DEFAULT_OT_BONUS_RATE = 0.6;

export type OtEntry = {
  id: string;
  date: number;
  shift: OtShiftId;
  workerIds: string[];
  workerNames: string[];
  /** เลขเครื่อง — ยอดต่อรอบ */
  machineCount: number;
  otherCups: number;
  iceCreamCones: number;
  breadSlices: number;
  claimCups: number;
  deductQty: number;
  deductReason: string;
  addQty: number;
  addReason: string;
  bonusRate: number;
  /** @deprecated ใช้ imageUrls — เก็บรูปแรกเพื่อ backward compat */
  imageUrl?: string;
  imageUrls?: string[];
  status: OtStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type OtEntryInput = {
  date: number;
  shift: OtShiftId;
  workerIds: string[];
  workerNames: string[];
  machineCount: number;
  otherCups?: number;
  iceCreamCones?: number;
  breadSlices?: number;
  claimCups?: number;
  deductQty?: number;
  deductReason?: string;
  addQty?: number;
  addReason?: string;
  bonusRate: number;
  imageUrl?: string;
  imageUrls?: string[];
  createdBy: string;
};

export type OtComputed = {
  summaryQty: number;
  totalBonus: number;
  workerCount: number;
  bonusPerPerson: number;
};

export type OtSettings = {
  bonusRate: number;
  updatedAt: number;
};

export function labelOtShift(shift: OtShiftId) {
  return OT_SHIFTS.find((s) => s.id === shift)?.label || shift;
}

export function parseOtShiftLabel(raw: string): OtShiftId | null {
  const t = String(raw || "").trim();
  if (t.includes("ดึก")) return "late";
  if (t.includes("เช้า")) return "morning";
  if (t.includes("เย็น")) return "evening";
  return null;
}

export function labelOtStatus(status: OtStatus) {
  if (status === "paid") return "จ่ายโบนัสแล้ว";
  if (status === "pending") return "เตรียมจ่ายโบนัส";
  return "ยังไม่จ่าย";
}

export function isOtEntryLocked(entry: Pick<OtEntry, "status">) {
  return entry.status === "paid";
}

/** มีตัวเลขยอดชง (สรุป ≠ 0) */
export function hasOtQuantities(
  entry: Pick<
    OtEntry,
    | "machineCount"
    | "otherCups"
    | "iceCreamCones"
    | "breadSlices"
    | "claimCups"
    | "deductQty"
    | "addQty"
    | "bonusRate"
    | "workerNames"
  >,
) {
  return computeOtBonus(entry).summaryQty !== 0;
}

/** วางแผนแล้ว — มีชื่อพนักงาน แต่ยังไม่มียอด */
export function isOtEntryPlanned(
  entry: Pick<
    OtEntry,
    | "workerNames"
    | "machineCount"
    | "otherCups"
    | "iceCreamCones"
    | "breadSlices"
    | "claimCups"
    | "deductQty"
    | "addQty"
    | "bonusRate"
  >,
) {
  const names = (entry.workerNames || []).filter(Boolean);
  if (!names.length) return false;
  return !hasOtQuantities(entry);
}

export function getOtImageUrls(entry?: Pick<OtEntry, "imageUrl" | "imageUrls"> | null): string[] {
  if (!entry) return [];
  if (Array.isArray(entry.imageUrls)) {
    return entry.imageUrls.map(String).filter((u) => u.trim());
  }
  if (entry.imageUrl?.trim()) return [entry.imageUrl.trim()];
  return [];
}

function mapOtEntryDoc(id: string, data: Record<string, unknown>): OtEntry {
  const imageUrls = Array.isArray(data.imageUrls)
    ? (data.imageUrls as string[]).map(String).filter((u) => u.trim())
    : data.imageUrl
      ? [String(data.imageUrl)]
      : [];
  return {
    id,
    date: Number(data.date) || 0,
    shift: (data.shift as OtShiftId) || "morning",
    workerIds: Array.isArray(data.workerIds) ? (data.workerIds as string[]) : [],
    workerNames: Array.isArray(data.workerNames) ? (data.workerNames as string[]) : [],
    machineCount: Number(data.machineCount) || 0,
    otherCups: Number(data.otherCups) || 0,
    iceCreamCones: Number(data.iceCreamCones) || 0,
    breadSlices: Number(data.breadSlices) || 0,
    claimCups: Number(data.claimCups) || 0,
    deductQty: Number(data.deductQty) || 0,
    deductReason: String(data.deductReason || ""),
    addQty: Number(data.addQty) || 0,
    addReason: String(data.addReason || ""),
    bonusRate: Number(data.bonusRate) || DEFAULT_OT_BONUS_RATE,
    imageUrl: imageUrls[0],
    imageUrls,
    status: (data.status as OtStatus) || "unpaid",
    createdBy: String(data.createdBy || ""),
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || 0,
  };
}

const OT_LOCKED_FIELDS = [
  "date",
  "shift",
  "workerIds",
  "workerNames",
  "machineCount",
  "otherCups",
  "iceCreamCones",
  "breadSlices",
  "claimCups",
  "deductQty",
  "deductReason",
  "addQty",
  "addReason",
  "bonusRate",
] as const;

function assertOtEntryEditable(
  current: OtEntry,
  patch: Partial<Pick<OtEntry, (typeof OT_LOCKED_FIELDS)[number]>>,
) {
  if (!isOtEntryLocked(current)) return;
  for (const key of OT_LOCKED_FIELDS) {
    if (patch[key] == null) continue;
    const next = patch[key];
    const prev = current[key];
    if (Array.isArray(next) && Array.isArray(prev)) {
      if (next.join("|") !== prev.join("|")) {
        throw new Error("รายการจ่ายแล้ว — แก้ยอด/เรทไม่ได้");
      }
      continue;
    }
    if (next !== prev) {
      throw new Error("รายการจ่ายแล้ว — แก้ยอด/เรทไม่ได้");
    }
  }
}

export function computeOtBonus(entry: {
  machineCount: number;
  otherCups?: number;
  iceCreamCones?: number;
  breadSlices?: number;
  claimCups?: number;
  deductQty?: number;
  addQty?: number;
  bonusRate: number;
  workerNames: string[];
}): OtComputed {
  const summaryQty =
    (Number(entry.machineCount) || 0) +
    (Number(entry.otherCups) || 0) +
    (Number(entry.iceCreamCones) || 0) +
    (Number(entry.breadSlices) || 0) -
    (Number(entry.claimCups) || 0) -
    (Number(entry.deductQty) || 0) +
    (Number(entry.addQty) || 0);
  const totalBonus = summaryQty * (Number(entry.bonusRate) || 0);
  const workerCount = Math.max(1, (entry.workerNames || []).filter(Boolean).length);
  return {
    summaryQty,
    totalBonus,
    workerCount,
    bonusPerPerson: totalBonus / workerCount,
  };
}

function entriesCol() {
  return collection(getDb(), "otEntries");
}

function settingsRef() {
  return doc(getDb(), "meta", "otSettings");
}

export async function getOtSettings(): Promise<OtSettings> {
  const snap = await getDoc(settingsRef());
  if (!snap.exists()) {
    return { bonusRate: DEFAULT_OT_BONUS_RATE, updatedAt: 0 };
  }
  const data = snap.data() as Partial<OtSettings>;
  return {
    bonusRate: Number(data.bonusRate) || DEFAULT_OT_BONUS_RATE,
    updatedAt: Number(data.updatedAt) || 0,
  };
}

export async function saveOtSettings(bonusRate: number): Promise<void> {
  await setDoc(
    settingsRef(),
    {
      bonusRate: Number(bonusRate) || DEFAULT_OT_BONUS_RATE,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export function subscribeOtEntries(
  onRows: (rows: OtEntry[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(entriesCol(), orderBy("date", "desc"), orderBy("createdAt", "desc")),
    (snap) => {
      onRows(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<OtEntry, "id">),
        })),
      );
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function addOtEntry(input: OtEntryInput): Promise<string> {
  if (!input.shift) throw new Error("เลือกรอบงาน");
  const now = Date.now();
  const imageUrls = (input.imageUrls || [])
    .map((u) => u.trim())
    .filter(Boolean);
  const legacyUrl = (input.imageUrl || "").trim();
  const urls = imageUrls.length ? imageUrls : legacyUrl ? [legacyUrl] : [];
  const ref = await addDoc(entriesCol(), {
    date: input.date,
    shift: input.shift,
    workerIds: input.workerIds,
    workerNames: input.workerNames,
    machineCount: Number(input.machineCount) || 0,
    otherCups: Number(input.otherCups) || 0,
    iceCreamCones: Number(input.iceCreamCones) || 0,
    breadSlices: Number(input.breadSlices) || 0,
    claimCups: Number(input.claimCups) || 0,
    deductQty: Number(input.deductQty) || 0,
    deductReason: (input.deductReason || "").trim(),
    addQty: Number(input.addQty) || 0,
    addReason: (input.addReason || "").trim(),
    bonusRate: Number(input.bonusRate) || DEFAULT_OT_BONUS_RATE,
    imageUrl: urls[0] || "",
    imageUrls: urls,
    status: "unpaid" as OtStatus,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateOtEntry(
  id: string,
  patch: Partial<
    Pick<
      OtEntry,
      | "date"
      | "shift"
      | "workerIds"
      | "workerNames"
      | "machineCount"
      | "otherCups"
      | "iceCreamCones"
      | "breadSlices"
      | "claimCups"
      | "deductQty"
      | "deductReason"
      | "addQty"
      | "addReason"
      | "bonusRate"
      | "imageUrl"
      | "imageUrls"
      | "status"
    >
  >,
): Promise<void> {
  const ref = doc(getDb(), "otEntries", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบรายการ");
  const current = mapOtEntryDoc(snap.id, snap.data() as Record<string, unknown>);
  assertOtEntryEditable(current, patch);

  const next: Record<string, string | number | boolean | string[]> = {
    updatedAt: Date.now(),
  };
  if (patch.date != null) next.date = patch.date;
  if (patch.shift != null) next.shift = patch.shift;
  if (patch.workerIds != null) next.workerIds = patch.workerIds;
  if (patch.workerNames != null) {
    next.workerNames = patch.workerNames;
  }
  if (patch.machineCount != null) next.machineCount = Number(patch.machineCount) || 0;
  if (patch.otherCups != null) next.otherCups = Number(patch.otherCups) || 0;
  if (patch.iceCreamCones != null) next.iceCreamCones = Number(patch.iceCreamCones) || 0;
  if (patch.breadSlices != null) next.breadSlices = Number(patch.breadSlices) || 0;
  if (patch.claimCups != null) next.claimCups = Number(patch.claimCups) || 0;
  if (patch.deductQty != null) next.deductQty = Number(patch.deductQty) || 0;
  if (patch.deductReason != null) next.deductReason = patch.deductReason.trim();
  if (patch.addQty != null) next.addQty = Number(patch.addQty) || 0;
  if (patch.addReason != null) next.addReason = patch.addReason.trim();
  if (patch.bonusRate != null) next.bonusRate = Number(patch.bonusRate) || DEFAULT_OT_BONUS_RATE;
  if (patch.imageUrls != null) {
    const urls = patch.imageUrls.map((u) => u.trim()).filter(Boolean);
    next.imageUrls = urls;
    next.imageUrl = urls[0] || "";
  } else if (patch.imageUrl != null) {
    const url = patch.imageUrl.trim();
    next.imageUrl = url;
    next.imageUrls = url ? [url] : [];
  }
  if (patch.status != null) next.status = patch.status;
  await updateDoc(ref, next);
}

export async function bulkUpdateOtEntryStatus(ids: string[], status: OtStatus): Promise<number> {
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
    batch.update(doc(db, "otEntries", id), { status, updatedAt: now });
    ops += 1;
    count += 1;
    if (ops >= 400) await flush();
  }
  await flush();
  return count;
}

export async function deleteOtEntry(id: string): Promise<void> {
  const ref = doc(getDb(), "otEntries", id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const current = mapOtEntryDoc(snap.id, snap.data() as Record<string, unknown>);
    if (isOtEntryLocked(current)) {
      throw new Error("รายการจ่ายแล้ว — ลบไม่ได้");
    }
  }
  await deleteDoc(ref);
}
