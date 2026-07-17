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

export type OtStatus = "pending" | "paid";

export function normalizeOtStatus(raw: unknown): OtStatus {
  return raw === "paid" ? "paid" : "pending";
}

export type OtShiftId = "late" | "morning" | "evening";

/** ลำดับแสดง: เย็น → เช้า → ดึก (บน→ล่าง) · ล่าง→บน = ดึก→เช้า→เย็น ต่อเนื่อง */
export const OT_SHIFTS: { id: OtShiftId; label: string }[] = [
  { id: "evening", label: "เย็น 17–0.3" },
  { id: "morning", label: "เช้า 7–17" },
  { id: "late", label: "ดึก 0.3–7" },
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
  checkIdOpen?: string;
  checkIdClose?: string;
  entryMode?: "single_batch" | "planned_then_closed" | "close_only";
  shiftClosedAt?: number;
  openSopSubmittedAt?: number;
  closeSopSubmittedAt?: number;
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
  checkIdOpen?: string;
  checkIdClose?: string;
  entryMode?: OtEntry["entryMode"];
  shiftClosedAt?: number;
  openSopSubmittedAt?: number;
  closeSopSubmittedAt?: number;
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
  if (status === "paid") return "จ่ายแล้ว";
  return "เตรียมจ่าย";
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

/** Already closed shift (has quantities) — amend photos/qty without re-running full close gates. */
export function isOtEntryClosed(
  entry:
    | Pick<
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
        | "shiftClosedAt"
      >
    | null
    | undefined,
) {
  if (!entry) return false;
  return hasOtQuantities(entry) || !!entry.shiftClosedAt;
}

export function getOtImageUrls(entry?: Pick<OtEntry, "imageUrl" | "imageUrls"> | null): string[] {
  if (!entry) return [];
  if (Array.isArray(entry.imageUrls) && entry.imageUrls.length) {
    const urls = entry.imageUrls.map(String).filter((u) => u.trim());
    if (urls.length) return urls;
  }
  if (entry.imageUrl?.trim()) return [entry.imageUrl.trim()];
  return [];
}

/**
 * Max product photos per OT shift close.
 * Photos save as evidencePhotos docs (`evp:`) so 10 fits safely on the OT row.
 * Legacy data-URL rows still constrained by OT_IMAGE_PAYLOAD_BUDGET.
 */
export const OT_IMAGE_MAX = 10;

/**
 * Safe budget for legacy data-URL payloads only (`imageUrl` + `imageUrls`).
 * Remote https URLs are tiny and skip this budget.
 */
export const OT_IMAGE_PAYLOAD_BUDGET = 650_000;

/** Chars written for photos (accounts for legacy imageUrl duplicating the first URL). */
export function otImagePayloadChars(urls: string[]): number {
  const cleaned = urls.map((u) => u.trim()).filter(Boolean);
  if (!cleaned.length) return 0;
  return cleaned.reduce((n, u) => n + u.length, 0) + cleaned[0]!.length;
}

function isDataUrlPhoto(url: string) {
  return url.trim().toLowerCase().startsWith("data:");
}

export function assertOtImageUrlsFit(urls: string[]): string[] {
  const capped = urls
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, OT_IMAGE_MAX);
  const dataOnly = capped.filter(isDataUrlPhoto);
  if (dataOnly.length) {
    const chars = otImagePayloadChars(dataOnly);
    if (chars > OT_IMAGE_PAYLOAD_BUDGET) {
      throw new Error(
        `รูปใหญ่รวมกันเกินไป (${dataOnly.length} รูปแบบเก่า) — ลบบางรูปหรือถ่ายใหม่แล้วลองอีกครั้ง`,
      );
    }
  }
  return capped;
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
    checkIdOpen: data.checkIdOpen ? String(data.checkIdOpen) : undefined,
    checkIdClose: data.checkIdClose ? String(data.checkIdClose) : undefined,
    entryMode: data.entryMode as OtEntry["entryMode"],
    shiftClosedAt: data.shiftClosedAt != null ? Number(data.shiftClosedAt) : undefined,
    openSopSubmittedAt:
      data.openSopSubmittedAt != null ? Number(data.openSopSubmittedAt) : undefined,
    closeSopSubmittedAt:
      data.closeSopSubmittedAt != null ? Number(data.closeSopSubmittedAt) : undefined,
    status: normalizeOtStatus(data.status),
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
      onRows(snap.docs.map((d) => mapOtEntryDoc(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function addOtEntry(input: OtEntryInput): Promise<string> {
  if (!input.shift) throw new Error("เลือกรอบงาน");
  const now = Date.now();
  const imageUrls = (input.imageUrls || []).map((u) => u.trim()).filter(Boolean);
  const legacyUrl = (input.imageUrl || "").trim();
  const urls = assertOtImageUrlsFit(
    imageUrls.length ? imageUrls : legacyUrl ? [legacyUrl] : [],
  );
  // เรทติดจากวันในตารางกะเท่านั้น — ไม่เชื่อค่าที่ฟอร์มส่งมา (กันบันทึกย้อนหลังโดนเรทใหม่)
  const { stampOtBonusRateForShiftDate } = await import("./ot-rate-repair");
  const bonusRate = await stampOtBonusRateForShiftDate(input.date);
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
    bonusRate,
    imageUrl: urls[0] || "",
    imageUrls: urls,
    checkIdOpen: input.checkIdOpen || null,
    checkIdClose: input.checkIdClose || null,
    entryMode: input.entryMode || null,
    shiftClosedAt: input.shiftClosedAt ?? null,
    openSopSubmittedAt: input.openSopSubmittedAt ?? null,
    closeSopSubmittedAt: input.closeSopSubmittedAt ?? null,
    status: "pending" as OtStatus,
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
      | "checkIdOpen"
      | "checkIdClose"
      | "entryMode"
      | "shiftClosedAt"
      | "openSopSubmittedAt"
      | "closeSopSubmittedAt"
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
  // ไม่จ่ายแล้ว: ติดเรทใหม่จากวันในตารางเสมอ — ไม่ใช้ patch.bonusRate จากฟอร์ม
  if (!isOtEntryLocked(current)) {
    const { stampOtBonusRateForShiftDate } = await import("./ot-rate-repair");
    const dateMs = patch.date != null ? Number(patch.date) : current.date;
    next.bonusRate = await stampOtBonusRateForShiftDate(dateMs);
  }
  if (patch.imageUrls != null) {
    const urls = assertOtImageUrlsFit(patch.imageUrls);
    next.imageUrls = urls;
    next.imageUrl = urls[0] || "";
  } else if (patch.imageUrl != null) {
    const urls = assertOtImageUrlsFit(patch.imageUrl.trim() ? [patch.imageUrl.trim()] : []);
    next.imageUrl = urls[0] || "";
    next.imageUrls = urls;
  }
  if (patch.status != null) next.status = patch.status;
  if (patch.checkIdOpen != null) next.checkIdOpen = patch.checkIdOpen;
  if (patch.checkIdClose != null) next.checkIdClose = patch.checkIdClose;
  if (patch.entryMode != null) next.entryMode = patch.entryMode;
  if (patch.shiftClosedAt != null) next.shiftClosedAt = patch.shiftClosedAt;
  if (patch.openSopSubmittedAt != null) next.openSopSubmittedAt = patch.openSopSubmittedAt;
  if (patch.closeSopSubmittedAt != null) next.closeSopSubmittedAt = patch.closeSopSubmittedAt;
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
