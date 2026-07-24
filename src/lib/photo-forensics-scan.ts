import {
  getEvidencePhotoMetaMany,
  isEvidencePhotoRef,
  type EvidencePhotoMeta,
} from "./evidence-photos";
import { photoDateMismatchHint } from "./image-capture-meta";

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
};

function emptyFlags(): PhotoForensicsEntryFlags {
  return { dateMismatch: false, duplicateHash: false, hints: [] };
}

/**
 * Scan evidence photos attached to rows (on-demand, owner).
 * Only `evp:` refs with stored meta can flag capture-date / hash duplicates.
 * Legacy https/data URLs are skipped (no meta).
 */
export async function scanPhotoForensics(
  rows: PhotoForensicsRowInput[],
): Promise<PhotoForensicsReport> {
  const byEntryId: Record<string, PhotoForensicsEntryFlags> = {};
  const dateMismatch: PhotoForensicsReport["dateMismatch"] = [];
  const allRefs: string[] = [];

  for (const row of rows) {
    byEntryId[row.entryId] = emptyFlags();
    for (const u of row.imageUrls) {
      if (isEvidencePhotoRef(u)) allRefs.push(u);
    }
  }

  const metaByUrl = await getEvidencePhotoMetaMany(allRefs);
  let photosWithCaptureMeta = 0;

  /** hash → entryIds that use it */
  const hashEntries = new Map<string, Set<string>>();
  const hashLabels = new Map<string, Set<string>>();

  for (const row of rows) {
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
    scannedEntries: rows.length,
    scannedPhotos: allRefs.length,
    photosWithCaptureMeta,
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
