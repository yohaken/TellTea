import type { ChecklistItem, ChecklistRecord, CheckSessionSummary } from "./checklist";
import { groupRecordsBySession, listItemsForTiming } from "./checklist";
import type { CheckShiftId } from "./checklist";
import type { OtEntry } from "./ot";
import { hasOtQuantities, isOtEntryPlanned } from "./ot";
import type { OtShiftId } from "./ot";
import { labelOtShift } from "./ot";
import { startOfLocalDay } from "./utils";

export type ShiftEntryMode = "single_batch" | "planned_then_closed" | "close_only";

export type ShiftSlotStatus = "empty" | "planned" | "partial" | "complete";

export type ShiftQualityFlags = {
  entryMode: ShiftEntryMode;
  singleBatch: boolean;
  openSopBackfilled: boolean;
};

export type ShiftProgress = {
  workersSet: boolean;
  openSopComplete: boolean;
  closeSopComplete: boolean;
  otComplete: boolean;
  completedCount: number;
  totalSteps: number;
  status: ShiftSlotStatus;
  missingLabels: string[];
  quality: ShiftQualityFlags | null;
};

const STEP_LABELS = {
  workers: "พนักงานกะ",
  openSop: "เช็คเปิดกะ",
  closeSop: "เช็คปิดกะ",
  ot: "ยอดชง",
} as const;

export function shiftSessionKey(date: number, shift: OtShiftId) {
  return `${startOfLocalDay(new Date(date))}_${shift}`;
}

export function getCurrentShiftId(now = new Date()): OtShiftId {
  const mins = now.getHours() * 60 + now.getMinutes();
  // ดึก 0.3–7 ≈ 00:18–07:00
  if (mins >= 18 && mins < 7 * 60) return "late";
  if (mins >= 7 * 60 && mins < 17 * 60) return "morning";
  return "evening";
}

function sessionCoversItems(
  session: CheckSessionSummary | null,
  items: ChecklistItem[],
): boolean {
  if (!session || !items.length) return items.length === 0;
  return session.total >= items.length;
}

export function getShiftCheckSessions(
  records: ChecklistRecord[],
  date: number,
  shift: CheckShiftId,
): { opening: CheckSessionSummary | null; closing: CheckSessionSummary | null } {
  const dayMs = startOfLocalDay(new Date(date));
  const dayShift = records.filter(
    (r) => startOfLocalDay(new Date(r.date)) === dayMs && r.shift === shift,
  );
  const sessions = groupRecordsBySession(dayShift);

  let opening: CheckSessionSummary | null = null;
  let closing: CheckSessionSummary | null = null;

  for (const session of sessions) {
    const sample = dayShift.find((r) => r.checkId === session.checkId);
    const kind = sample?.sessionKind || "full";
    if (kind === "opening" && (!opening || session.submittedAt > opening.submittedAt)) {
      opening = session;
    }
    if (kind === "closing" && (!closing || session.submittedAt > closing.submittedAt)) {
      closing = session;
    }
    if (kind === "full") {
      if (!opening || session.submittedAt > opening.submittedAt) opening = session;
      if (!closing || session.submittedAt > closing.submittedAt) closing = session;
    }
  }

  return { opening, closing };
}

export function detectEntryMode(
  hadPlannedBefore: boolean,
  singleBatch: boolean,
): ShiftEntryMode {
  if (hadPlannedBefore) return "planned_then_closed";
  if (singleBatch) return "single_batch";
  return "close_only";
}

export function computeShiftQuality(
  entry: Pick<
    OtEntry,
    "entryMode" | "openSopSubmittedAt" | "closeSopSubmittedAt" | "shiftClosedAt"
  > | null,
): ShiftQualityFlags | null {
  if (!entry?.shiftClosedAt) return null;
  const openAt = entry.openSopSubmittedAt || 0;
  const closedAt = entry.shiftClosedAt;
  const spreadMs = Math.abs(closedAt - openAt);
  const singleBatch = spreadMs < 120_000 && openAt > 0;
  const openSopBackfilled = singleBatch && openAt > 0;
  const entryMode =
    entry.entryMode ||
    detectEntryMode(false, singleBatch);

  return {
    entryMode,
    singleBatch,
    openSopBackfilled,
  };
}

export function computeLiveShiftProgress(input: {
  workersSet: boolean;
  openingItems: ChecklistItem[];
  closingItems: ChecklistItem[];
  openingDraftsComplete: boolean;
  closingDraftsComplete: boolean;
  otComplete: boolean;
  quality?: ShiftQualityFlags | null;
}): ShiftProgress {
  const openSopComplete = input.openingItems.length === 0 || input.openingDraftsComplete;
  const closeSopComplete = input.closingItems.length === 0 || input.closingDraftsComplete;
  const missingLabels: string[] = [];
  if (!input.workersSet) missingLabels.push(STEP_LABELS.workers);
  if (input.openingItems.length && !openSopComplete) missingLabels.push(STEP_LABELS.openSop);
  if (input.closingItems.length && !closeSopComplete) missingLabels.push(STEP_LABELS.closeSop);
  if (!input.otComplete) missingLabels.push(STEP_LABELS.ot);

  const steps = [
    input.workersSet,
    openSopComplete,
    closeSopComplete,
    input.otComplete,
  ];
  const completedCount = steps.filter(Boolean).length;
  const totalSteps = steps.length;

  let status: ShiftSlotStatus = "empty";
  if (completedCount === 0) status = "empty";
  else if (completedCount < totalSteps) status = "partial";
  else status = "complete";

  return {
    workersSet: input.workersSet,
    openSopComplete,
    closeSopComplete,
    otComplete: input.otComplete,
    completedCount,
    totalSteps,
    status,
    missingLabels,
    quality: input.quality ?? null,
  };
}

export function computeShiftProgress(input: {
  entry: OtEntry | null;
  records: ChecklistRecord[];
  openingItems: ChecklistItem[];
  closingItems: ChecklistItem[];
  date: number;
  shift: OtShiftId;
}): ShiftProgress {
  const { entry, records, openingItems, closingItems, date, shift } = input;
  const workersSet = !!(entry?.workerNames || []).filter(Boolean).length;
  const { opening, closing } = getShiftCheckSessions(records, date, shift);

  const openSopComplete = openingItems.length === 0 || sessionCoversItems(opening, openingItems);
  const closeSopComplete = closingItems.length === 0 || sessionCoversItems(closing, closingItems);
  const otComplete = entry ? hasOtQuantities(entry) : false;

  const missingLabels: string[] = [];
  if (!workersSet) missingLabels.push(STEP_LABELS.workers);
  if (openingItems.length && !openSopComplete) missingLabels.push(STEP_LABELS.openSop);
  if (closingItems.length && !closeSopComplete) missingLabels.push(STEP_LABELS.closeSop);
  if (!otComplete) missingLabels.push(STEP_LABELS.ot);

  const steps = [
    workersSet,
    openingItems.length ? openSopComplete : true,
    closingItems.length ? closeSopComplete : true,
    otComplete,
  ];
  const totalSteps = steps.length;
  const completedCount = steps.filter(Boolean).length;

  let status: ShiftSlotStatus = "empty";
  if (completedCount === 0) {
    status = "empty";
  } else if (completedCount === totalSteps) {
    status = "complete";
  } else if (entry && isOtEntryPlanned(entry) && !otComplete) {
    status = "planned";
  } else {
    status = "partial";
  }

  const quality = entry ? computeShiftQuality(entry) : null;

  return {
    workersSet,
    openSopComplete,
    closeSopComplete,
    otComplete,
    completedCount,
    totalSteps,
    status,
    missingLabels,
    quality,
  };
}

export function labelShiftSlotStatus(status: ShiftSlotStatus) {
  if (status === "empty") return "ว่าง";
  if (status === "planned") return "วางแผน";
  if (status === "partial") return "ค้าง";
  return "ครบ";
}

export function labelEntryMode(mode: ShiftEntryMode) {
  if (mode === "planned_then_closed") return "วางแผนก่อน ปิดทีหลัง";
  if (mode === "single_batch") return "กรอกครั้งเดียว";
  return "ปิดกะอย่างเดียว";
}

export function ownerQualityHints(flags: ShiftQualityFlags | null): string[] {
  if (!flags) return [];
  const hints: string[] = [];
  if (flags.singleBatch) hints.push("กรอก SOP+ยอดพร้อมกัน");
  if (flags.openSopBackfilled) hints.push("เช็คเปิดกะกรอกตอนปิดกะ");
  if (flags.entryMode === "planned_then_closed") hints.push("วางแผนก่อนปิดกะ");
  return hints;
}

export function todayShiftBannerLabel(shift: OtShiftId) {
  const word = labelOtShift(shift).split(" ")[0] || labelOtShift(shift);
  return `กะ${word}`;
}

/** ข้อความสั้นสำหรับแถบกะวันนี้ — ไม่ลิสต์ยาว */
export function shiftBannerStatusShort(progress: ShiftProgress): string {
  if (progress.status === "complete") return "ปิดกะครบแล้ว";
  if (progress.status === "empty") return "ยังไม่ปิดกะ";
  if (progress.status === "planned") return "วางแผนแล้ว — รอปิดกะ";
  return `ค้าง ${progress.missingLabels.length} ข้อ`;
}

export function shiftCloseButtonLabel(progress: ShiftProgress): string {
  if (progress.status === "complete") return "ดูรายการ";
  if (progress.status === "empty") return "ปิดกะ";
  return `ปิดกะ (${progress.missingLabels.length})`;
}

export function filterRecordsForShift(
  records: ChecklistRecord[],
  date: number,
  shift: OtShiftId,
) {
  const dayMs = startOfLocalDay(new Date(date));
  return records.filter(
    (r) => startOfLocalDay(new Date(r.date)) === dayMs && r.shift === shift,
  );
}

export function openingItemsFromCatalog(items: ChecklistItem[]) {
  return listItemsForTiming(items, "opening");
}

export function closingItemsFromCatalog(items: ChecklistItem[]) {
  return listItemsForTiming(items, "closing");
}
