import {
  getFirebaseAuth,
} from "./firebase";
import { compressImageForUpload, fileToReceiptDataUrl } from "./receipts";
import { saveEvidencePhotoDoc } from "./evidence-photos";

function safeSegment(raw: string) {
  return (
    String(raw || "x")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 48) || "x"
  );
}

/** Soft ceiling when preparing large camera originals. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
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
  percent: number;
  overallPercent: number;
  online: boolean;
  message: string;
};

export type UploadEvidenceOptions = {
  folder: string;
  slotKey: string;
  onProgress?: (p: PhotoUploadProgress) => void;
  cancelRef?: { current: boolean };
  getCancelTask?: (task: unknown) => void;
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Prepare a tax-evidence photo for upload.
 * Keeps original bytes when already a reasonable image under the size cap.
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
      "รูปใหญ่เกินลิมิต (10MB) — เลือกไฟล์หลักฐานที่ชัดแต่ขนาดเล็กลงเล็กน้อย",
    );
  }
  return out;
}

/**
 * Canonical evidence upload for TellTea.
 * Primary: one Firestore doc per photo (`evp:{id}`) — real progress, no Storage hang.
 */
export async function uploadEvidencePhotos(
  files: File[],
  options: UploadEvidenceOptions,
): Promise<string[]> {
  if (!files.length) return [];
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
      message: "กำลังเชื่อมต่อฐานข้อมูล…",
    });

    emit(options.onProgress, {
      phase: "preparing",
      fileIndex: i,
      fileCount: total,
      fileName,
      bytesTransferred: 0,
      totalBytes: file.size || 1,
      percent: 8,
      overallPercent: Math.round(((i + 0.08) / total) * 100),
      message: `กำลังเตรียมไฟล์หลักฐาน (${i + 1}/${total})…`,
    });

    try {
      const refKey = await withTimeout(
        saveEvidencePhotoDoc(file, {
          folder: folderSeg,
          slotKey: slotSeg,
          onProgress: (percent, message) => {
            const overall = Math.round(((i + percent / 100) / total) * 100);
            emit(options.onProgress, {
              phase: percent >= 100 ? "finalizing" : percent >= 50 ? "uploading" : "preparing",
              fileIndex: i,
              fileCount: total,
              fileName,
              bytesTransferred: Math.round(((file.size || 1) * percent) / 100),
              totalBytes: file.size || 1,
              percent,
              overallPercent: overall,
              message: `${message} (${i + 1}/${total})`,
            });
          },
        }),
        45_000,
        "บันทึกรูปหลักฐาน",
      );

      emit(options.onProgress, {
        phase: "finalizing",
        fileIndex: i,
        fileCount: total,
        fileName,
        bytesTransferred: file.size || 1,
        totalBytes: file.size || 1,
        percent: 100,
        overallPercent: Math.round(((i + 1) / total) * 100),
        message: `บันทึกรูปหลักฐานแล้ว (${i + 1}/${total})`,
      });
      urls.push(refKey);
    } catch (err) {
      const msg = friendlyStorageUploadError(err);
      emit(options.onProgress, {
        phase: "error",
        fileIndex: i,
        fileCount: total,
        fileName,
        bytesTransferred: 0,
        totalBytes: file.size || 1,
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

  if (/timed out/i.test(raw)) {
    return "บันทึกรูปใช้เวลานานเกินไป — ลองใหม่อีกครั้งบน Wi‑Fi";
  }
  if (/permission-denied|insufficient permissions/i.test(code + raw)) {
    return "ไม่มีสิทธิ์บันทึกรูป — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง";
  }
  if (/ยกเลิก|abort/i.test(code + raw)) {
    return "ยกเลิกการอัปโหลดแล้ว";
  }
  if (/offline|Failed to fetch|network|ออฟไลน์/i.test(code + raw)) {
    return "เครือข่ายไม่เสถียรขณะบันทึกรูป — รอสักครู่แล้วลองใหม่";
  }
  if (/เข้าสู่ระบบ|ฐานข้อมูล|ใหญ่เกิน|หลักฐาน/.test(raw)) {
    return raw;
  }
  return raw.trim() || "อัปโหลดรูปไม่สำเร็จ";
}

export function isRemotePhotoUrl(url: string) {
  return /^https?:\/\//i.test(url.trim()) || url.trim().startsWith("evp:");
}

/** Legacy helper (OT): evidence doc first, then tight data-URL. */
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
    if (/เข้าสู่ระบบ/.test(msg)) throw err;
    console.warn("Evidence photo doc failed, falling back to data URL:", msg);
  }
  const compressed = await compressImageForUpload(file, 1280, 0.72);
  return fileToReceiptDataUrl(compressed, softDataUrlChars);
}
