import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  type UploadTask,
} from "firebase/storage";
import { getFirebaseAuth, getFirebaseStorage, isFirebaseStorageConfigured } from "./firebase";
import { compressImageForUpload, fileToReceiptDataUrl } from "./receipts";

function safeSegment(raw: string) {
  return (
    String(raw || "x")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 48) || "x"
  );
}

/** Soft ceiling for evidence files (must stay under Storage rules). */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
/** Only shrink if over size — keep tax-evidence detail. */
export const EVIDENCE_MAX_EDGE = 4096;
export const EVIDENCE_JPEG_QUALITY = 0.92;

export type PhotoUploadPhase =
  | "checking"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "done"
  | "error";

export type PhotoUploadProgress = {
  phase: PhotoUploadPhase;
  fileIndex: number;
  fileCount: number;
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  /** 0–100 for current file */
  percent: number;
  /** Overall batch percent */
  overallPercent: number;
  online: boolean;
  message: string;
};

export type UploadEvidenceOptions = {
  folder: string;
  slotKey: string;
  onProgress?: (p: PhotoUploadProgress) => void;
  cancelRef?: { current: boolean };
  getCancelTask?: (task: UploadTask | null) => void;
};

function onlineNow() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function emit(
  onProgress: UploadEvidenceOptions["onProgress"],
  partial: Omit<PhotoUploadProgress, "online"> & { online?: boolean },
) {
  onProgress?.({
    ...partial,
    online: partial.online ?? onlineNow(),
  });
}

/**
 * Prepare a tax-evidence photo for Storage.
 * Keeps original bytes when already a reasonable image under the size cap.
 * Does NOT downscale unless the file exceeds Storage limits.
 */
export async function prepareEvidencePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("ไฟล์ต้องเป็นรูปภาพ");
  }
  const type = (file.type || "image/jpeg").toLowerCase();
  const keepAsIs =
    file.size > 0 &&
    file.size <= EVIDENCE_MAX_BYTES &&
    (type === "image/jpeg" ||
      type === "image/jpg" ||
      type === "image/png" ||
      type === "image/webp");

  if (keepAsIs) return file;

  // HEIC / unknown / oversized — re-encode at high quality; shrink only if still over cap.
  let edge = EVIDENCE_MAX_EDGE;
  let quality = EVIDENCE_JPEG_QUALITY;
  let out = await compressImageForUpload(file, edge, quality);
  while (out.size > EVIDENCE_MAX_BYTES && quality > 0.75) {
    quality -= 0.04;
    out = await compressImageForUpload(file, edge, quality);
  }
  while (out.size > EVIDENCE_MAX_BYTES && edge > 1800) {
    edge = Math.round(edge * 0.85);
    out = await compressImageForUpload(file, edge, quality);
  }
  if (out.size > EVIDENCE_MAX_BYTES) {
    throw new Error(
      "รูปใหญ่เกินลิมิตคลังรูป (10MB) — เลือกไฟล์หลักฐานที่ชัดแต่ขนาดเล็กลงเล็กน้อย",
    );
  }
  return out;
}

function uploadOneResumable(
  prepared: File,
  path: string,
  meta: Record<string, string>,
  onBytes: (transferred: number, total: number) => void,
  cancelRef?: { current: boolean },
  registerTask?: (task: UploadTask | null) => void,
): Promise<string> {
  const storage = getFirebaseStorage();
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, prepared, {
    contentType: prepared.type || "image/jpeg",
    customMetadata: meta,
  });
  registerTask?.(task);

  return new Promise((resolve, reject) => {
    const unsub = task.on(
      "state_changed",
      (snap) => {
        if (cancelRef?.current) {
          task.cancel();
          return;
        }
        onBytes(snap.bytesTransferred, snap.totalBytes || prepared.size || 1);
      },
      (err) => {
        registerTask?.(null);
        unsub();
        reject(err);
      },
      () => {
        registerTask?.(null);
        unsub();
        void getDownloadURL(task.snapshot.ref).then(resolve, reject);
      },
    );
  });
}

/**
 * Canonical evidence upload — real Firebase Storage, short https URLs for Firestore.
 * Use for tax slips / multi-photo modules. No data-URL fallback.
 */
export async function uploadEvidencePhotos(
  files: File[],
  options: UploadEvidenceOptions,
): Promise<string[]> {
  if (!files.length) return [];
  if (!isFirebaseStorageConfigured()) {
    throw new Error("คลังรูป (Firebase Storage) ยังไม่ได้ตั้งค่า — ติดต่อเจ้าของระบบ");
  }
  const auth = getFirebaseAuth();
  if (!auth.currentUser) {
    throw new Error("ยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบก่อนแนบรูป");
  }
  if (!onlineNow()) {
    throw new Error("ไม่มีการเชื่อมต่ออินเทอร์เน็ต — เชื่อมต่อแล้วลองใหม่");
  }

  const folderSeg = safeSegment(options.folder);
  const slotSeg = safeSegment(options.slotKey);
  const urls: string[] = [];
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    if (options.cancelRef?.current) {
      throw new Error("ยกเลิกการอัปโหลดแล้ว");
    }
    const file = files[i]!;
    const fileName = file.name || `รูปที่ ${i + 1}`;

    emit(options.onProgress, {
      phase: "checking",
      fileIndex: i,
      fileCount: total,
      fileName,
      bytesTransferred: 0,
      totalBytes: file.size || 1,
      percent: 0,
      overallPercent: Math.round((i / total) * 100),
      message: onlineNow()
        ? "กำลังตรวจสอบการเชื่อมต่อคลังรูป…"
        : "ออฟไลน์ — รอเครือข่าย",
    });

    if (!onlineNow()) {
      throw new Error("การเชื่อมต่อหลุดระหว่างอัปโหลด — ลองใหม่อีกครั้ง");
    }

    emit(options.onProgress, {
      phase: "preparing",
      fileIndex: i,
      fileCount: total,
      fileName,
      bytesTransferred: 0,
      totalBytes: file.size || 1,
      percent: 0,
      overallPercent: Math.round((i / total) * 100),
      message: "กำลังเตรียมไฟล์หลักฐาน (คงคุณภาพ)…",
    });

    const prepared = await prepareEvidencePhoto(file);
    const ext =
      prepared.type === "image/png" ? "png" : prepared.type === "image/webp" ? "webp" : "jpg";
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${safeSegment(fileName).slice(0, 24)}.${ext}`;
    const path = `${folderSeg}/${slotSeg}/${name}`;

    emit(options.onProgress, {
      phase: "uploading",
      fileIndex: i,
      fileCount: total,
      fileName,
      bytesTransferred: 0,
      totalBytes: prepared.size || 1,
      percent: 0,
      overallPercent: Math.round((i / total) * 100),
      message: `กำลังอัปโหลดไปคลังรูป (${i + 1}/${total})…`,
    });

    try {
      const url = await uploadOneResumable(
        prepared,
        path,
        {
          uploadedBy: auth.currentUser.uid,
          slotKey: slotSeg,
          folder: folderSeg,
          originalName: fileName.slice(0, 120),
          evidence: "1",
        },
        (transferred, totalBytes) => {
          const pct = Math.min(100, Math.round((transferred / Math.max(1, totalBytes)) * 100));
          const overall = Math.round(((i + transferred / Math.max(1, totalBytes)) / total) * 100);
          emit(options.onProgress, {
            phase: "uploading",
            fileIndex: i,
            fileCount: total,
            fileName,
            bytesTransferred: transferred,
            totalBytes,
            percent: pct,
            overallPercent: overall,
            message: `กำลังอัปโหลดไปคลังรูป (${i + 1}/${total}) ${pct}%`,
          });
        },
        options.cancelRef,
        options.getCancelTask,
      );

      emit(options.onProgress, {
        phase: "finalizing",
        fileIndex: i,
        fileCount: total,
        fileName,
        bytesTransferred: prepared.size,
        totalBytes: prepared.size,
        percent: 100,
        overallPercent: Math.round(((i + 1) / total) * 100),
        message: `บันทึกลิงก์รูปแล้ว (${i + 1}/${total})`,
      });
      urls.push(url);
    } catch (err) {
      const msg = friendlyStorageUploadError(err);
      emit(options.onProgress, {
        phase: "error",
        fileIndex: i,
        fileCount: total,
        fileName,
        bytesTransferred: 0,
        totalBytes: prepared.size || 1,
        percent: 0,
        overallPercent: Math.round((i / total) * 100),
        message: msg,
      });
      throw new Error(msg);
    }
  }

  emit(options.onProgress, {
    phase: "done",
    fileIndex: Math.max(0, total - 1),
    fileCount: total,
    fileName: "",
    bytesTransferred: 1,
    totalBytes: 1,
    percent: 100,
    overallPercent: 100,
    message: `อัปโหลดครบ ${total} รูปแล้ว`,
  });

  return urls;
}

export function friendlyStorageUploadError(err: unknown): string {
  const raw =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message || "")
      : String(err || "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";

  if (/storage\/unauthorized|permission/i.test(code + raw)) {
    return "ไม่มีสิทธิ์อัปโหลดคลังรูป — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง";
  }
  if (/storage\/canceled|cancelled|ยกเลิก/i.test(code + raw)) {
    return "ยกเลิกการอัปโหลดแล้ว";
  }
  if (/storage\/retry-limit|network|offline|Failed to fetch|timeout/i.test(code + raw)) {
    return "เครือข่ายไม่เสถียรขณะอัปโหลด — รอสักครู่แล้วลองใหม่";
  }
  if (/storage\/quota|exceeded/i.test(code + raw)) {
    return "คลังรูปเต็มโควต้า — ติดต่อเจ้าของระบบ";
  }
  if (/เข้าสู่ระบบ|คลังรูป|ออฟไลน์|อินเทอร์เน็ต|ใหญ่เกิน/.test(raw)) {
    return raw;
  }
  return raw.trim() || "อัปโหลดรูปไปคลังไม่สำเร็จ";
}

export function isRemotePhotoUrl(url: string) {
  return /^https?:\/\//i.test(url.trim());
}

/**
 * Legacy helper (OT etc.): Storage uploadBytesResumable with tight data-URL fallback.
 * Prefer uploadEvidencePhotos for new modules (tax / multi-slip).
 */
export async function uploadAppPhoto(
  file: File,
  folder: string,
  slotKey: string,
  softDataUrlChars = 52_000,
): Promise<string> {
  try {
    const urls = await uploadEvidencePhotos([file], { folder, slotKey });
    if (urls[0]) return urls[0];
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    if (/เข้าสู่ระบบ|ยังไม่ได้ตั้งค่า/.test(msg)) throw err;
    console.warn("Storage evidence upload failed, falling back to data URL:", msg);
  }
  const compressed = await compressImageForUpload(file, 1280, 0.72);
  return fileToReceiptDataUrl(compressed, softDataUrlChars);
}
