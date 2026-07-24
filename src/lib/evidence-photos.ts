import { addDoc, collection, doc, getDoc } from "firebase/firestore";
import { getDb, getFirebaseAuth } from "./firebase";
import { extractImageCaptureMeta } from "./image-capture-meta";
import { fileToLogoDataUrl, fileToReceiptDataUrl } from "./receipts";

/** Short refs stored on ledger/owner-books rows — full bytes live in evidencePhotos/{id}. */
export const EVIDENCE_PHOTO_PREFIX = "evp:";

/** Soft target per evidence image (one Firestore doc = one photo, under 1 MiB). */
export const EVIDENCE_PHOTO_SOFT_CHARS = 820_000;

export type EvidencePhotoDoc = {
  dataUrl: string;
  contentType: string;
  fileName: string;
  folder: string;
  slotKey: string;
  createdBy: string;
  /** Upload time (ms) */
  createdAt: number;
  byteEstimate: number;
  /** Best-effort original capture time (EXIF or file mtime) */
  capturedAt?: number;
  fileLastModified?: number;
  /** exif | file */
  captureSource?: string;
  /** SHA-256 of original file bytes */
  contentHash?: string;
};

export type EvidencePhotoMeta = {
  uploadedAt: number;
  capturedAt: number | null;
  fileLastModified: number | null;
  captureSource: string;
  contentHash: string;
  fileName: string;
  folder: string;
};

const cache = new Map<string, string>();
const metaCache = new Map<string, EvidencePhotoMeta>();

export function isEvidencePhotoRef(url: string) {
  return String(url || "").startsWith(EVIDENCE_PHOTO_PREFIX);
}

export function evidencePhotoIdFromRef(ref: string) {
  if (!isEvidencePhotoRef(ref)) return "";
  return ref.slice(EVIDENCE_PHOTO_PREFIX.length).trim();
}

export function evidencePhotoRefFromId(id: string) {
  return `${EVIDENCE_PHOTO_PREFIX}${id}`;
}

function mapPhotoMeta(data: Record<string, unknown>): EvidencePhotoMeta {
  return {
    uploadedAt: Number(data.createdAt) || 0,
    capturedAt: Number(data.capturedAt) || null,
    fileLastModified: Number(data.fileLastModified) || null,
    captureSource: String(data.captureSource || ""),
    contentHash: String(data.contentHash || ""),
    fileName: String(data.fileName || ""),
    folder: String(data.folder || ""),
  };
}

/**
 * Save one tax-evidence photo as its own Firestore document.
 * Returns a short `evp:{id}` ref for the parent row (keeps ownerBooks under 1 MiB).
 * Progress is real and local — no Firebase Storage dependency.
 */
export async function saveEvidencePhotoDoc(
  file: File,
  options: {
    folder: string;
    slotKey: string;
    onProgress?: (percent: number, message: string) => void;
    /** logo = keep PNG alpha (brand mark); receipt = JPEG compress */
    encode?: "receipt" | "logo";
  },
): Promise<string> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) {
    throw new Error("ยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบก่อนแนบรูป");
  }

  const encode = options.encode || "receipt";
  options.onProgress?.(3, "กำลังอ่านเวลาถ่าย…");
  // Capture meta BEFORE canvas re-encode (EXIF is stripped there).
  const capture = await extractImageCaptureMeta(file);

  options.onProgress?.(8, encode === "logo" ? "กำลังเตรียมโลโก้…" : "กำลังเตรียมรูป…");
  // Keep quality high; only shrink if over soft Firestore-doc budget.
  // Logo path preserves PNG transparency instead of flattening to JPEG.
  const dataUrl =
    encode === "logo"
      ? await fileToLogoDataUrl(file)
      : await fileToReceiptDataUrl(file, EVIDENCE_PHOTO_SOFT_CHARS);
  options.onProgress?.(55, "กำลังบันทึก…");

  const isPng = dataUrl.startsWith("data:image/png");
  const now = Date.now();
  const payload: EvidencePhotoDoc = {
    dataUrl,
    contentType:
      encode === "logo"
        ? isPng
          ? "image/png"
          : file.type || "image/png"
        : file.type || "image/jpeg",
    fileName: (file.name || (encode === "logo" ? "logo.png" : "slip.jpg")).slice(0, 120),
    folder: options.folder,
    slotKey: options.slotKey,
    createdBy: auth.currentUser.uid,
    createdAt: now,
    byteEstimate: dataUrl.length,
  };
  if (capture.capturedAt) payload.capturedAt = capture.capturedAt;
  if (capture.fileLastModified) payload.fileLastModified = capture.fileLastModified;
  if (capture.captureSource) payload.captureSource = capture.captureSource;
  if (capture.contentHash) payload.contentHash = capture.contentHash;

  const ref = await addDoc(collection(getDb(), "evidencePhotos"), payload);
  const key = evidencePhotoRefFromId(ref.id);
  cache.set(key, dataUrl);
  metaCache.set(key, mapPhotoMeta(payload as unknown as Record<string, unknown>));
  options.onProgress?.(100, "บันทึกแล้ว");
  return key;
}

/** Load forensics meta for an `evp:` ref (no need to decode image). */
export async function getEvidencePhotoMeta(url: string): Promise<EvidencePhotoMeta | null> {
  const raw = String(url || "").trim();
  if (!isEvidencePhotoRef(raw)) return null;
  const hit = metaCache.get(raw);
  if (hit) return hit;
  const id = evidencePhotoIdFromRef(raw);
  if (!id) return null;
  const snap = await getDoc(doc(getDb(), "evidencePhotos", id));
  if (!snap.exists()) return null;
  const meta = mapPhotoMeta(snap.data() as Record<string, unknown>);
  metaCache.set(raw, meta);
  return meta;
}

/** Batch meta fetch (dedupes refs; uses cache). */
export async function getEvidencePhotoMetaMany(
  urls: string[],
): Promise<Map<string, EvidencePhotoMeta>> {
  const out = new Map<string, EvidencePhotoMeta>();
  const unique = [...new Set(urls.map((u) => String(u || "").trim()).filter(Boolean))];
  await Promise.all(
    unique.map(async (url) => {
      const meta = await getEvidencePhotoMeta(url);
      if (meta) out.set(url, meta);
    }),
  );
  return out;
}

/** Resolve an `evp:` ref (or pass-through https/data URL) to an img-displayable src. */
export async function resolveEvidencePhotoSrc(url: string): Promise<string> {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (!isEvidencePhotoRef(raw)) return raw;
  const hit = cache.get(raw);
  if (hit) return hit;
  const id = evidencePhotoIdFromRef(raw);
  if (!id) return "";
  const snap = await getDoc(doc(getDb(), "evidencePhotos", id));
  if (!snap.exists()) {
    throw new Error("ไม่พบรูปหลักฐานในฐานข้อมูล");
  }
  const data = snap.data() as Record<string, unknown>;
  const dataUrl = String(data.dataUrl || "");
  if (!dataUrl.startsWith("data:")) {
    throw new Error("รูปหลักฐานในฐานข้อมูลเสียหาย");
  }
  cache.set(raw, dataUrl);
  metaCache.set(raw, mapPhotoMeta(data));
  return dataUrl;
}

export async function resolveEvidencePhotoSrcList(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    out.push(await resolveEvidencePhotoSrc(u));
  }
  return out;
}

export function isPersistableReceiptUrl(url: string) {
  const u = String(url || "").trim();
  if (!u) return false;
  if (isEvidencePhotoRef(u)) return true;
  if (/^https?:\/\//i.test(u)) return true;
  return false;
}
