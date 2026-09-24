/**
 * Production photo QA — conflict detection within confusion groups only.
 * Does NOT verify exact flavor match (e.g. soft-cookie cocoa vs matcha in the same wrap).
 */
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import {
  PHOTO_FORENSICS_LOOKBACK_DAYS,
  filterRowsByLookback,
} from "./photo-forensics-scan";
import type {
  ProdEntry,
  ProdPhotoQa,
  ProdPhotoQaConflictLevel,
  ProdPhotoQaVerifyStatus,
  ProdProduct,
} from "./production";

export const PROD_PHOTO_QA_LOOKBACK_DAYS = PHOTO_FORENSICS_LOOKBACK_DAYS;
/** Client wait — slightly under CF 60s so we surface timeout before the function hard-kills. */
export const PROD_PHOTO_QA_TIMEOUT_MS = 55_000;

export type ProdPhotoQaConfirmKind = "conflict" | "ai_unavailable";

/** Firestore rejects `undefined` in document fields — drop those keys. */
export function compactProdPhotoQa(qa: ProdPhotoQa): ProdPhotoQa {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(qa)) {
    if (value !== undefined) out[key] = value;
  }
  return out as ProdPhotoQa;
}

export type ProdConfusionGroup = {
  id: string;
  label: string;
  /** Substrings matched against product name (case-insensitive / Thai as-is) */
  nameMatchers: string[];
  /**
   * Within this group AI must never flag flavor conflicts
   * (soft cookie cocoa vs matcha look the same wrapped).
   * Client skips the vision call entirely.
   */
  flavorBlind?: boolean;
};

/** Seed groups — owner can later move to meta/prodPhotoQa without code change. */
export const DEFAULT_PROD_CONFUSION_GROUPS: ProdConfusionGroup[] = [
  {
    id: "yam",
    label: "กลุ่มมัน",
    nameMatchers: [
      "มันอบ",
      "ขนมปังมันม่วง",
      "มันไทย",
      "ปังมันม่วง",
      "มันม่วง",
    ],
  },
  {
    id: "soft-cookie",
    label: "กลุ่มซอฟคุกกี้",
    nameMatchers: ["ซอฟคุ๊กกี้", "ซอฟคุกกี้", "soft cookie", "softcookie"],
    flavorBlind: true,
  },
];

function normName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function findConfusionGroupForProductName(
  productName: string,
  groups: ProdConfusionGroup[] = DEFAULT_PROD_CONFUSION_GROUPS,
): ProdConfusionGroup | null {
  const n = normName(productName);
  if (!n) return null;
  for (const g of groups) {
    for (const m of g.nameMatchers) {
      const mm = normName(m);
      if (mm && n.includes(mm)) return g;
    }
  }
  return null;
}

export function productNamesInGroup(
  products: Pick<ProdProduct, "name">[],
  group: ProdConfusionGroup,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const name = String(p.name || "").trim();
    if (!name) continue;
    const hit = findConfusionGroupForProductName(name, [group]);
    if (!hit) continue;
    const key = normName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  // Always include matchers as fallback labels for AI even if not in catalog
  for (const m of group.nameMatchers) {
    const name = m.trim();
    if (!name) continue;
    const key = normName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Needs live AI call (in a non–flavor-blind confusion group). */
export function shouldRunProdPhotoConflictAi(productName: string): boolean {
  const g = findConfusionGroupForProductName(productName);
  return Boolean(g && !g.flavorBlind);
}

export type VerifyProdPhotoConflictResult = {
  conflictLevel: ProdPhotoQaConflictLevel;
  suggestedProductName: string;
  reason: string;
  model: string;
  usedImages: number;
  skipped?: boolean;
  skipReason?: string;
};

export async function verifyProdPhotoConflict(input: {
  selectedProductName: string;
  groupProductNames: string[];
  imageUrls: string[];
  flavorBlind?: boolean;
  groupId?: string;
  groupLabel?: string;
}): Promise<VerifyProdPhotoConflictResult> {
  const fn = httpsCallable<
    {
      selectedProductName: string;
      groupProductNames: string[];
      imageUrls: string[];
      flavorBlind?: boolean;
      groupId?: string;
      groupLabel?: string;
    },
    VerifyProdPhotoConflictResult
  >(getFirebaseFunctions(), "verifyProdPhotoConflict");

  const callPromise = fn({
    selectedProductName: input.selectedProductName.trim(),
    groupProductNames: input.groupProductNames.map((n) => n.trim()).filter(Boolean),
    imageUrls: input.imageUrls.map((u) => u.trim()).filter(Boolean).slice(0, 2),
    ...(input.flavorBlind ? { flavorBlind: true } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.groupLabel ? { groupLabel: input.groupLabel } : {}),
  });
  // Prevent unhandled rejection if client timeout wins the race first.
  void callPromise.catch(() => {});

  const raced = await Promise.race([
    callPromise.then((r) => ({ ok: true as const, data: r.data })),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(
        () => resolve({ ok: false, error: "หมดเวลารอ AI" }),
        PROD_PHOTO_QA_TIMEOUT_MS,
      ),
    ),
  ]);

  if (!raced.ok) {
    return {
      conflictLevel: "uncertain",
      suggestedProductName: "",
      reason: raced.error,
      model: "",
      usedImages: 0,
      skipped: true,
      skipReason: raced.error,
    };
  }

  const data = raced.data;
  const level = String(data?.conflictLevel || "").trim();
  const conflictLevel: ProdPhotoQaConflictLevel =
    level === "conflict" || level === "uncertain" || level === "none"
      ? level
      : "uncertain";

  return {
    conflictLevel,
    suggestedProductName: String(data?.suggestedProductName || "").trim(),
    reason: String(data?.reason || "").trim().slice(0, 120),
    model: String(data?.model || ""),
    usedImages: Number(data?.usedImages) || 0,
    skipped: Boolean(data?.skipped),
    skipReason: data?.skipReason ? String(data.skipReason) : undefined,
  };
}

/**
 * Build photoQa for save after AI (or skip).
 * staffConfirmedPhotoMatch = staff explicitly confirmed photo matches selected product
 * (after conflict OR after AI timeout/outage).
 */
export function buildProdPhotoQa(input: {
  productId: string;
  productName: string;
  result: VerifyProdPhotoConflictResult;
  staffConfirmedPhotoMatch?: boolean;
  /** @deprecated use staffConfirmedPhotoMatch */
  staffConfirmedDespiteConflict?: boolean;
  previous?: ProdPhotoQa | null;
  flaggedBy?: string;
}): ProdPhotoQa {
  const now = Date.now();
  const { result, previous } = input;
  const wasFlagged = previous?.verifyStatus === "flagged";
  const staffConfirmed =
    Boolean(input.staffConfirmedPhotoMatch) ||
    Boolean(input.staffConfirmedDespiteConflict);

  // Staff explicitly confirmed photo ↔ product (heart of the gate).
  if (staffConfirmed) {
    return compactProdPhotoQa({
      verifyStatus: "conflict_confirmed",
      conflictLevel: result.conflictLevel === "conflict" ? "conflict" : "uncertain",
      selectedProductId: input.productId,
      selectedProductName: input.productName,
      ...(result.suggestedProductName.trim()
        ? { aiSuggestedProductName: result.suggestedProductName.trim() }
        : {}),
      aiReason:
        result.reason ||
        (result.skipped
          ? "พนักงานยืนยันว่ารูปตรงสินค้า หลัง AI ไม่พร้อม"
          : "พนักงานยืนยันว่ารูปตรงสินค้า"),
      staffAction: "confirmed",
      checkedAt: now,
      ...(wasFlagged ? { fixedAt: now } : {}),
    });
  }

  if (result.skipped) {
    // Confusion-group AI outage without staff confirm → hold bonus until confirmed.
    return compactProdPhotoQa({
      verifyStatus: "pending",
      conflictLevel: "uncertain",
      selectedProductId: input.productId,
      selectedProductName: input.productName,
      aiReason: result.reason || result.skipReason || "รอพนักงานยืนยันรูป (AI ไม่พร้อม)",
      checkedAt: now,
      flaggedAt: now,
      flaggedBy: input.flaggedBy || "ai_outage",
      ...(wasFlagged && previous?.flaggedAt
        ? { flaggedAt: previous.flaggedAt, flaggedBy: previous.flaggedBy }
        : {}),
    });
  }

  if (result.conflictLevel === "conflict") {
    return compactProdPhotoQa({
      verifyStatus: "flagged",
      conflictLevel: "conflict",
      selectedProductId: input.productId,
      selectedProductName: input.productName,
      ...(result.suggestedProductName.trim()
        ? { aiSuggestedProductName: result.suggestedProductName.trim() }
        : {}),
      ...(result.reason.trim() ? { aiReason: result.reason.trim() } : {}),
      checkedAt: now,
      flaggedAt: now,
      flaggedBy: input.flaggedBy || "ai",
    });
  }

  // none / uncertain → ok or fixed
  const verifyStatus: ProdPhotoQaVerifyStatus = wasFlagged ? "fixed" : "ok";
  return compactProdPhotoQa({
    verifyStatus,
    conflictLevel: result.conflictLevel,
    selectedProductId: input.productId,
    selectedProductName: input.productName,
    ...(result.suggestedProductName.trim()
      ? { aiSuggestedProductName: result.suggestedProductName.trim() }
      : {}),
    ...(result.reason.trim() ? { aiReason: result.reason.trim() } : {}),
    checkedAt: now,
    ...(wasFlagged
      ? {
          fixedAt: now,
          ...(previous?.flaggedAt != null ? { flaggedAt: previous.flaggedAt } : {}),
          ...(previous?.flaggedBy ? { flaggedBy: previous.flaggedBy } : {}),
        }
      : {}),
  });
}

/** Local skip path — no CF (outside group or flavor-blind). */
export function buildSkippedOkPhotoQa(input: {
  productId: string;
  productName: string;
  reason: string;
  previous?: ProdPhotoQa | null;
}): ProdPhotoQa {
  const now = Date.now();
  const wasFlagged = input.previous?.verifyStatus === "flagged";
  return compactProdPhotoQa({
    verifyStatus: wasFlagged ? "fixed" : "ok",
    conflictLevel: "none",
    selectedProductId: input.productId,
    selectedProductName: input.productName,
    aiReason: input.reason,
    checkedAt: now,
    ...(wasFlagged
      ? {
          fixedAt: now,
          ...(input.previous?.flaggedAt != null
            ? { flaggedAt: input.previous.flaggedAt }
            : {}),
          ...(input.previous?.flaggedBy
            ? { flaggedBy: input.previous.flaggedBy }
            : {}),
        }
      : {}),
  });
}

export async function runProdPhotoQaForSave(input: {
  productId: string;
  productName: string;
  imageUrls: string[];
  products: Pick<ProdProduct, "name">[];
  previous?: ProdPhotoQa | null;
  /** Staff already confirmed photo matches selected product */
  staffConfirmedPhotoMatch?: boolean;
  /** @deprecated use staffConfirmedPhotoMatch */
  staffConfirmedDespiteConflict?: boolean;
}): Promise<{
  photoQa: ProdPhotoQa;
  needsStaffConfirm: boolean;
  confirmKind: ProdPhotoQaConfirmKind | null;
  result: VerifyProdPhotoConflictResult | null;
}> {
  const staffConfirmed =
    Boolean(input.staffConfirmedPhotoMatch) ||
    Boolean(input.staffConfirmedDespiteConflict);
  const group = findConfusionGroupForProductName(input.productName);

  if (!group) {
    return {
      photoQa: buildSkippedOkPhotoQa({
        productId: input.productId,
        productName: input.productName,
        reason: "นอกกลุ่มสับสน — ไม่ตรวจ AI",
        previous: input.previous,
      }),
      needsStaffConfirm: false,
      confirmKind: null,
      result: null,
    };
  }

  if (group.flavorBlind) {
    return {
      photoQa: buildSkippedOkPhotoQa({
        productId: input.productId,
        productName: input.productName,
        reason: `${group.label} — ไม่แยกรสจากรูปห่อ`,
        previous: input.previous,
      }),
      needsStaffConfirm: false,
      confirmKind: null,
      result: null,
    };
  }

  const groupNames = productNamesInGroup(input.products, group);
  let result: VerifyProdPhotoConflictResult;
  try {
    result = await verifyProdPhotoConflict({
      selectedProductName: input.productName,
      groupProductNames: groupNames,
      imageUrls: input.imageUrls,
      groupId: group.id,
      groupLabel: group.label,
    });
  } catch (err) {
    result = {
      conflictLevel: "uncertain",
      suggestedProductName: "",
      reason: (err as Error).message || "ตรวจ AI ไม่สำเร็จ",
      model: "",
      usedImages: 0,
      skipped: true,
      skipReason: (err as Error).message || "ตรวจ AI ไม่สำเร็จ",
    };
  }

  // Heart: confusion-group products need human confirm when AI conflicts OR is down.
  if (!staffConfirmed) {
    if (result.skipped) {
      return {
        photoQa: buildProdPhotoQa({
          productId: input.productId,
          productName: input.productName,
          result,
          previous: input.previous,
          flaggedBy: "ai_outage",
        }),
        needsStaffConfirm: true,
        confirmKind: "ai_unavailable",
        result,
      };
    }
    if (result.conflictLevel === "conflict") {
      return {
        photoQa: buildProdPhotoQa({
          productId: input.productId,
          productName: input.productName,
          result,
          previous: input.previous,
        }),
        needsStaffConfirm: true,
        confirmKind: "conflict",
        result,
      };
    }
  }

  return {
    photoQa: buildProdPhotoQa({
      productId: input.productId,
      productName: input.productName,
      result,
      staffConfirmedPhotoMatch: staffConfirmed,
      previous: input.previous,
      flaggedBy: result.skipped ? "ai_outage" : "ai",
    }),
    needsStaffConfirm: false,
    confirmKind: null,
    result,
  };
}

export type ProdPhotoQaScanRow = {
  entryId: string;
  entryDate: number;
  label: string;
  productId: string;
  productName: string;
  imageUrls: string[];
  photoQa?: ProdPhotoQa;
};

export type ProdPhotoQaBatchReport = {
  windowStart: number;
  windowEnd: number;
  scanned: number;
  flagged: number;
  ok: number;
  skipped: number;
  errors: { entryId: string; label: string; message: string }[];
  flaggedIds: string[];
};

/**
 * Owner batch: scan lookback entries in checkable groups; persist flagged on conflict.
 */
export async function scanProdPhotoQaBatch(
  rows: ProdPhotoQaScanRow[],
  opts: {
    products: Pick<ProdProduct, "name" | "id">[];
    lookbackDays?: number;
    updateEntry: (id: string, photoQa: ProdPhotoQa) => Promise<void>;
  },
): Promise<ProdPhotoQaBatchReport> {
  const lookbackDays = opts.lookbackDays ?? PROD_PHOTO_QA_LOOKBACK_DAYS;
  const scoped = filterRowsByLookback(
    rows.map((r) => ({
      entryId: r.entryId,
      entryDate: r.entryDate,
      label: r.label,
      imageUrls: r.imageUrls,
    })),
    lookbackDays,
  );
  const scopedIds = new Set(scoped.map((r) => r.entryId));
  const candidates = rows.filter((r) => scopedIds.has(r.entryId));

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const windowEnd = now;
  const windowStart = now - lookbackDays * dayMs;

  const report: ProdPhotoQaBatchReport = {
    windowStart,
    windowEnd,
    scanned: 0,
    flagged: 0,
    ok: 0,
    skipped: 0,
    errors: [],
    flaggedIds: [],
  };

  for (const row of candidates) {
    const urls = (row.imageUrls || []).filter(Boolean);
    if (!urls.length) continue;

    const status = row.photoQa?.verifyStatus;
    // Skip already reviewed (unless skipped — re-try)
    if (
      status === "ok" ||
      status === "fixed" ||
      status === "conflict_confirmed" ||
      status === "flagged"
    ) {
      continue;
    }

    if (!shouldRunProdPhotoConflictAi(row.productName)) continue;

    report.scanned += 1;
    try {
      const { photoQa, result } = await runProdPhotoQaForSave({
        productId: row.productId,
        productName: row.productName,
        imageUrls: urls,
        products: opts.products,
        previous: row.photoQa,
      });

      let next = photoQa;
      if (result?.conflictLevel === "conflict" && !result.skipped) {
        next = {
          ...photoQa,
          verifyStatus: "flagged",
          conflictLevel: "conflict",
          flaggedAt: Date.now(),
          flaggedBy: "ai_batch",
        };
        report.flagged += 1;
        report.flaggedIds.push(row.entryId);
      } else if (result?.skipped || next.verifyStatus === "pending") {
        // AI outage on batch → hold bonus until staff opens and confirms.
        next = {
          ...photoQa,
          verifyStatus: "pending",
          conflictLevel: "uncertain",
          flaggedAt: Date.now(),
          flaggedBy: "ai_batch_outage",
          aiReason: result?.reason || result?.skipReason || photoQa.aiReason,
        };
        report.skipped += 1;
      } else if (next.verifyStatus === "skipped") {
        report.skipped += 1;
      } else {
        report.ok += 1;
      }

      await opts.updateEntry(row.entryId, next);
    } catch (err) {
      report.errors.push({
        entryId: row.entryId,
        label: row.label,
        message: (err as Error).message || "สแกนไม่สำเร็จ",
      });
    }
  }

  return report;
}

export function prodEntryNeedsPhotoQaFix(entry: Pick<ProdEntry, "photoQa">): boolean {
  const s = entry.photoQa?.verifyStatus;
  return s === "flagged" || s === "pending";
}

export type OwnerEntryPhotoQaCheckOutcome =
  | { ok: true; photoQa: ProdPhotoQa; outcome: "ok" | "flagged" | "pending" | "skipped" }
  | { ok: false; message: string };

/**
 * Owner commands AI on one saved entry (not batch).
 * Conflict → flagged · AI outage → pending · flavor-blind / no group → skipped ok.
 */
export async function runOwnerEntryPhotoQaCheck(input: {
  productId: string;
  productName: string;
  imageUrls: string[];
  products: Pick<ProdProduct, "name" | "id">[];
  previous?: ProdPhotoQa | null;
}): Promise<OwnerEntryPhotoQaCheckOutcome> {
  const urls = (input.imageUrls || []).filter(Boolean);
  if (!urls.length) {
    return { ok: false, message: "ยังไม่มีรูปในรายการนี้" };
  }
  if (!shouldRunProdPhotoConflictAi(input.productName)) {
    const photoQa = buildSkippedOkPhotoQa({
      productId: input.productId,
      productName: input.productName,
      previous: input.previous,
      reason: "ไม่อยู่กลุ่มสับสนที่ต้องตรวจ AI",
    });
    return { ok: true, photoQa, outcome: "skipped" };
  }

  const { photoQa, result } = await runProdPhotoQaForSave({
    productId: input.productId,
    productName: input.productName,
    imageUrls: urls,
    products: input.products,
    previous: input.previous,
  });

  if (result?.conflictLevel === "conflict" && !result.skipped) {
    return {
      ok: true,
      photoQa: compactProdPhotoQa({
        ...photoQa,
        verifyStatus: "flagged",
        conflictLevel: "conflict",
        flaggedAt: Date.now(),
        flaggedBy: "ai_owner",
      }),
      outcome: "flagged",
    };
  }
  if (result?.skipped || photoQa.verifyStatus === "pending") {
    return {
      ok: true,
      photoQa: compactProdPhotoQa({
        ...photoQa,
        verifyStatus: "pending",
        conflictLevel: "uncertain",
        flaggedAt: Date.now(),
        flaggedBy: "ai_owner_outage",
        aiReason: result?.reason || result?.skipReason || photoQa.aiReason,
      }),
      outcome: "pending",
    };
  }
  if (photoQa.verifyStatus === "skipped") {
    return { ok: true, photoQa, outcome: "skipped" };
  }
  return { ok: true, photoQa, outcome: "ok" };
}

/** Owner manually marks photo ≠ product (when AI failed or after visual review). */
export function buildOwnerManualFlagPhotoQa(input: {
  productId: string;
  productName: string;
  previous?: ProdPhotoQa | null;
  reason?: string;
}): ProdPhotoQa {
  const now = Date.now();
  return {
    verifyStatus: "flagged",
    conflictLevel: "conflict",
    selectedProductId: input.productId,
    selectedProductName: input.productName,
    aiSuggestedProductName: input.previous?.aiSuggestedProductName,
    aiReason: (input.reason || "เจ้าของติดป้าย — รูปไม่ตรงสินค้า").slice(0, 120),
    checkedAt: now,
    flaggedAt: now,
    flaggedBy: "owner",
  };
}

/** Owner clears a flag after reviewing (bonus counts again). */
export function buildOwnerClearPhotoQa(input: {
  productId: string;
  productName: string;
  previous?: ProdPhotoQa | null;
}): ProdPhotoQa {
  const now = Date.now();
  const wasHeld =
    input.previous?.verifyStatus === "flagged" ||
    input.previous?.verifyStatus === "pending";
  return {
    verifyStatus: wasHeld ? "fixed" : "ok",
    conflictLevel: "none",
    selectedProductId: input.productId,
    selectedProductName: input.productName,
    aiReason: "เจ้าของปลดป้าย",
    staffAction: undefined,
    checkedAt: now,
    ...(wasHeld
      ? {
          fixedAt: now,
          flaggedAt: input.previous?.flaggedAt,
          flaggedBy: input.previous?.flaggedBy,
        }
      : {}),
  };
}

/** Staff-facing short label for table badge */
export function prodPhotoQaBadgeLabel(
  entry: Pick<ProdEntry, "photoQa"> | null | undefined,
): string | null {
  const s = entry?.photoQa?.verifyStatus;
  if (s === "pending") return "ตรวจอีกครั้ง";
  if (s === "flagged") return "ไม่ตรง";
  return null;
}

/** Longer title/tooltip for badge hover */
export function prodPhotoQaBadgeTitle(
  entry: Pick<ProdEntry, "photoQa"> | null | undefined,
): string | null {
  const s = entry?.photoQa?.verifyStatus;
  if (s === "pending") {
    return (
      entry?.photoQa?.aiReason ||
      "ให้ตรวจสอบรายการอีกครั้ง — รูปกับสินค้ายังไม่ยืนยัน · พักโบนัส"
    );
  }
  if (s === "flagged") {
    return entry?.photoQa?.aiReason || "รายการไม่ตรง — รูปไม่ตรงสินค้า";
  }
  return null;
}
