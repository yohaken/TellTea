import {
  getEvidencePhotoMetaMany,
  isEvidencePhotoRef,
  type EvidencePhotoMeta,
} from "./evidence-photos";
import { photoDateMismatchHint } from "./image-capture-meta";

/** Default owner retrospective window (inclusive of today). */
export const PHOTO_FORENSICS_LOOKBACK_DAYS = 10;

export type PhotoForensicsRowInput = {
  entryId: string;
  entryDate: number;
  label: string;
  imageUrls: string[];
};

export type PhotoForensicsEntryFlags = {
  dateMismatch: boolean;
  duplicateHash: boolean;
  hints: string[];
};

export type PhotoForensicsDuplicateGroup = {
  hash: string;
  entryIds: string[];
  labels: string[];
};

export type PhotoForensicsReport = {
  byEntryId: Record<string, PhotoForensicsEntryFlags>;
  dateMismatch: { entryId: string; label: string; hint: string }[];
  duplicates: PhotoForensicsDuplicateGroup[];
  scannedEntries: number;
  scannedPhotos: number;
  photosWithCaptureMeta: number;
  /** Inclusive lookback window used for this scan */
  lookbackDays: number;
  windowStart: number;
  windowEnd: number;
};

function emptyFlags(): PhotoForensicsEntryFlags {
  return { dateMismatch: false, duplicateHash: false, hints: [] };
}

/** Local midnight of (today − (days−1)) so a 10-day window includes today. */
export function lookbackWindowStartMs(
  days: number = PHOTO_FORENSICS_LOOKBACK_DAYS,
  now: number = Date.now(),
): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const n = Math.max(1, Math.floor(days));
  d.setDate(d.getDate() - (n - 1));
  return d.getTime();
}

export function filterRowsByLookback(
  rows: PhotoForensicsRowInput[],
  days: number = PHOTO_FORENSICS_LOOKBACK_DAYS,
  now: number = Date.now(),
): PhotoForensicsRowInput[] {
  const start = lookbackWindowStartMs(days, now);
  return rows.filter((r) => Number(r.entryDate) >= start);
}

/**
 * Scan evidence photos attached to rows (on-demand, owner).
 * Only `evp:` refs with stored meta can flag capture-date / hash duplicates.
 * Legacy https/data URLs are skipped (no meta).
 * Upload-day mismatch still works for older evidencePhotos (createdAt always existed).
 */
export async function scanPhotoForensics(
  rows: PhotoForensicsRowInput[],
  options?: { lookbackDays?: number; now?: number },
): Promise<PhotoForensicsReport> {
  const lookbackDays = options?.lookbackDays ?? PHOTO_FORENSICS_LOOKBACK_DAYS;
  const now = options?.now ?? Date.now();
  const windowStart = lookbackWindowStartMs(lookbackDays, now);
  const windowEnd = now;
  const scoped = filterRowsByLookback(rows, lookbackDays, now);

  const byEntryId: Record<string, PhotoForensicsEntryFlags> = {};
  const dateMismatch: PhotoForensicsReport["dateMismatch"] = [];
  const allRefs: string[] = [];

  for (const row of scoped) {
    byEntryId[row.entryId] = emptyFlags();
    for (const u of row.imageUrls) {
      if (isEvidencePhotoRef(u)) allRefs.push(u);
    }
  }

  const metaByUrl = await getEvidencePhotoMetaMany(allRefs);
  let photosWithCaptureMeta = 0;

  const hashEntries = new Map<string, Set<string>>();
  const hashLabels = new Map<string, Set<string>>();

  for (const row of scoped) {
    const flags = byEntryId[row.entryId]!;
    const hints = new Set<string>();

    for (const url of row.imageUrls) {
      const meta: EvidencePhotoMeta | undefined = metaByUrl.get(url);
      if (!meta) continue;
      if (meta.capturedAt) photosWithCaptureMeta += 1;

      const hint = photoDateMismatchHint(row.entryDate, {
        capturedAt: meta.capturedAt,
        uploadedAt: meta.uploadedAt,
      });
      if (hint) {
        flags.dateMismatch = true;
        hints.add(hint);
      }

      if (meta.contentHash) {
        let set = hashEntries.get(meta.contentHash);
        if (!set) {
          set = new Set();
          hashEntries.set(meta.contentHash, set);
        }
        set.add(row.entryId);
        let labs = hashLabels.get(meta.contentHash);
        if (!labs) {
          labs = new Set();
          hashLabels.set(meta.contentHash, labs);
        }
        labs.add(row.label);
      }
    }

    if (hints.size) {
      flags.hints = [...hints];
      dateMismatch.push({
        entryId: row.entryId,
        label: row.label,
        hint: flags.hints[0]!,
      });
    }
  }

  const duplicates: PhotoForensicsDuplicateGroup[] = [];
  for (const [hash, entryIds] of hashEntries) {
    if (entryIds.size < 2) continue;
    const ids = [...entryIds];
    for (const id of ids) {
      const flags = byEntryId[id];
      if (!flags) continue;
      flags.duplicateHash = true;
      if (!flags.hints.includes("รูปซ้ำข้ามรายการ")) {
        flags.hints.push("รูปซ้ำข้ามรายการ");
      }
    }
    duplicates.push({
      hash: hash.slice(0, 12),
      entryIds: ids,
      labels: [...(hashLabels.get(hash) || [])],
    });
  }

  return {
    byEntryId,
    dateMismatch,
    duplicates,
    scannedEntries: scoped.length,
    scannedPhotos: allRefs.length,
    photosWithCaptureMeta,
    lookbackDays,
    windowStart,
    windowEnd,
  };
}

export function entryHasPhotoFlag(
  report: PhotoForensicsReport | null,
  entryId: string,
): boolean {
  if (!report) return false;
  const f = report.byEntryId[entryId];
  return !!(f && (f.dateMismatch || f.duplicateHash));
}
