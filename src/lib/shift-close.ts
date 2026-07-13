import {
  newCheckId,
  submitChecklistBatch,
  type CheckSessionKind,
  type CheckShiftId,
} from "./checklist";
import { addOtEntry, updateOtEntry, type OtEntry, type OtEntryInput } from "./ot";
import { detectEntryMode } from "./shift-session";
import type { SopDraftItem } from "@/components/ShiftSopSection";
import { validateSopDrafts } from "@/components/ShiftSopSection";

export async function submitSopDrafts(
  drafts: SopDraftItem[],
  input: {
    date: number;
    shift: CheckShiftId;
    sessionKind: CheckSessionKind;
    inspector: string;
    inspectorId: string;
    createdBy: string;
    submittedAt: number;
    existingCheckId?: string;
  },
): Promise<string> {
  const err = validateSopDrafts(
    drafts,
    input.sessionKind === "opening" ? "เช็คเปิดกะ" : "เช็คปิดกะ",
  );
  if (err) throw new Error(err);

  const checkId = newCheckId();
  await submitChecklistBatch(
    drafts.map((d) => ({
      checkId,
      date: input.date,
      shift: input.shift,
      sessionKind: input.sessionKind,
      inspector: input.inspector,
      inspectorId: input.inspectorId,
      itemId: d.itemId,
      itemName: d.itemName,
      status: d.status as "pass" | "fail",
      remark: d.remark,
      submittedAt: input.submittedAt,
      createdBy: input.createdBy,
    })),
  );
  return checkId;
}

export async function saveShiftClose(input: {
  entry: OtEntry | null;
  allEntries: OtEntry[];
  payload: OtEntryInput;
  openingDrafts: SopDraftItem[];
  closingDrafts: SopDraftItem[];
  openingItemsCount: number;
  closingItemsCount: number;
  inspector: { id: string; name: string };
  hadPlannedBefore: boolean;
  findExistingForSlot: (
    entries: OtEntry[],
    date: number,
    shift: OtEntry["shift"],
  ) => OtEntry | null;
}): Promise<void> {
  const {
    entry,
    allEntries,
    payload,
    openingDrafts,
    closingDrafts,
    openingItemsCount,
    closingItemsCount,
    inspector,
    hadPlannedBefore,
    findExistingForSlot,
  } = input;

  if (openingItemsCount > 0) {
    const err = validateSopDrafts(openingDrafts, "เช็คเปิดกะ");
    if (err) throw new Error(err);
  }
  if (closingItemsCount > 0) {
    const err = validateSopDrafts(closingDrafts, "เช็คปิดกะ");
    if (err) throw new Error(err);
  }

  const closedAt = Date.now();
  const openAt = openingItemsCount > 0 ? closedAt : 0;
  const closeAt = closingItemsCount > 0 ? closedAt : closedAt;
  const singleBatch =
    openingItemsCount > 0 && closingItemsCount > 0 && Math.abs(closeAt - openAt) < 120_000;

  let checkIdOpen = entry?.checkIdOpen;
  let checkIdClose = entry?.checkIdClose;

  if (openingItemsCount > 0) {
    checkIdOpen = await submitSopDrafts(openingDrafts, {
      date: payload.date,
      shift: payload.shift,
      sessionKind: "opening",
      inspector: inspector.name,
      inspectorId: inspector.id,
      createdBy: payload.createdBy,
      submittedAt: openAt,
      existingCheckId: checkIdOpen,
    });
  }

  if (closingItemsCount > 0) {
    checkIdClose = await submitSopDrafts(closingDrafts, {
      date: payload.date,
      shift: payload.shift,
      sessionKind: "closing",
      inspector: inspector.name,
      inspectorId: inspector.id,
      createdBy: payload.createdBy,
      submittedAt: closeAt,
      existingCheckId: checkIdClose,
    });
  }

  const fullPayload: OtEntryInput = {
    ...payload,
    checkIdOpen,
    checkIdClose,
    entryMode: detectEntryMode(hadPlannedBefore, singleBatch),
    shiftClosedAt: closedAt,
    openSopSubmittedAt: openingItemsCount > 0 ? openAt : undefined,
    closeSopSubmittedAt: closingItemsCount > 0 ? closeAt : undefined,
  };

  if (entry) {
    await updateOtEntry(entry.id, fullPayload);
    return;
  }

  const existing = findExistingForSlot(allEntries, payload.date, payload.shift);
  if (existing) {
    await updateOtEntry(existing.id, fullPayload);
  } else {
    await addOtEntry(fullPayload);
  }
}
