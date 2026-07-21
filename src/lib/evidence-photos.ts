import { addDoc, collection, doc, getDoc } from "firebase/firestore";
import { getDb, getFirebaseAuth } from "./firebase";
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
  createdAt: number;
  byteEstimate: number;
};

const cache = new Map<string, string>();

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
  options.onProgress?.(5, encode === "logo" ? "กำลังเตรียมโลโก้…" : "กำลังเตรียมไฟล์หลักฐาน…");
  // Keep quality high; only shrink if over soft Firestore-doc budget.
  // Logo path preserves PNG transparency instead of flattening to JPEG.
  const dataUrl =
    encode === "logo"
      ? await fileToLogoDataUrl(file)
      : await fileToReceiptDataUrl(file, EVIDENCE_PHOTO_SOFT_CHARS);
  options.onProgress?.(55, "กำลังบันทึกลงฐานข้อมูล…");

  const isPng = dataUrl.startsWith("data:image/png");
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
    createdAt: Date.now(),
    byteEstimate: dataUrl.length,
  };

  const ref = await addDoc(collection(getDb(), "evidencePhotos"), payload);
  const key = evidencePhotoRefFromId(ref.id);
  cache.set(key, dataUrl);
  options.onProgress?.(100, "บันทึกรูปหลักฐานแล้ว");
  return key;
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
  const dataUrl = String(snap.data()?.dataUrl || "");
  if (!dataUrl.startsWith("data:")) {
    throw new Error("รูปหลักฐานในฐานข้อมูลเสียหาย");
  }
  cache.set(raw, dataUrl);
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
