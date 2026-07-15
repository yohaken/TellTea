import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  type UploadTask,
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import {
  getFirebaseAuth,
  getFirebaseFunctions,
  getFirebaseStorage,
  isFirebaseStorageConfigured,
} from "./firebase";
import { compressImageForUpload, fileToReceiptDataUrl } from "./receipts";

function safeSegment(raw: string) {
  return (
    String(raw || "x")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 48) || "x"
  );
}

/** Soft ceiling for evidence files (must stay under Storage rules / CF). */
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
  getCancelTask?: (task: UploadTask | null) => void;
};

type CreateEvidenceUploadResult = {
  uploadUrl: string;
  path: string;
  token: string;
  contentType: string;
  bucket: string;
  expiresInSec: number;
};

type FinalizeEvidenceUploadResult = {
  downloadUrl: string;
  path: string;
  token: string;
  size: number;
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
      "รูปใหญ่เกินลิมิตคลังรูป (10MB) — เลือกไฟล์หลักฐานที่ชัดแต่ขนาดเล็กลงเล็กน้อย",
    );
  }
  return out;
}

function putWithProgress(
  uploadUrl: string,
  body: Blob,
  contentType: string,
  onBytes: (transferred: number, total: number) => void,
  cancelRef?: { current: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (ev) => {
      if (cancelRef?.current) {
        xhr.abort();
        return;
      }
      if (ev.lengthComputable) onBytes(ev.loaded, ev.total);
      else onBytes(ev.loaded, body.size || 1);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`อัปโหลดคลังรูปไม่สำเร็จ (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("เครือข่ายหลุดขณะอัปโหลดคลังรูป"));
    xhr.onabort = () => reject(new Error("ยกเลิกการอัปโหลดแล้ว"));
    xhr.send(body);
  });
}

/** Preferred path: Cloud Function signed URL → GCS PUT → finalize download token. */
async function uploadViaSignedUrl(
  prepared: File,
  folder: string,
  slotKey: string,
  fileName: string,
  onBytes: (transferred: number, total: number) => void,
  cancelRef?: { current: boolean },
): Promise<string> {
  const functions = getFirebaseFunctions();
  const create = httpsCallable<
    { folder: string; slotKey: string; contentType: string; fileName: string },
    CreateEvidenceUploadResult
  >(functions, "createEvidenceUpload");
  const finalize = httpsCallable<
    { path: string; token: string },
    FinalizeEvidenceUploadResult
  >(functions, "finalizeEvidenceUpload");

  const contentType = prepared.type || "image/jpeg";
  const created = await create({
    folder,
    slotKey,
    contentType,
    fileName,
  });
  const payload = created.data;
  if (!payload?.uploadUrl || !payload.path || !payload.token) {
    throw new Error("เซิร์ฟเวอร์ไม่ได้ส่งลิงก์อัปโหลด");
  }

  await putWithProgress(
    payload.uploadUrl,
    prepared,
    payload.contentType || contentType,
    onBytes,
    cancelRef,
  );

  const done = await finalize({ path: payload.path, token: payload.token });
  if (!done.data?.downloadUrl) {
    throw new Error("เซิร์ฟเวอร์ไม่ได้ส่งลิงก์ดูรูป");
  }
  return done.data.downloadUrl;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Reliable Admin path: send bytes through Cloud Function (no client Storage rules). */
async function uploadViaCloudFunctionBytes(
  prepared: File,
  folder: string,
  slotKey: string,
  fileName: string,
  onBytes: (transferred: number, total: number) => void,
): Promise<string> {
  const functions = getFirebaseFunctions();
  const upload = httpsCallable<
    {
      folder: string;
      slotKey: string;
      contentType: string;
      fileName: string;
      base64: string;
    },
    { downloadUrl: string; path: string; token: string; size: number }
  >(functions, "uploadEvidencePhoto");

  onBytes(0, prepared.size || 1);
  const base64 = await blobToBase64(prepared);
  onBytes(Math.round((prepared.size || 1) * 0.35), prepared.size || 1);
  const result = await upload({
    folder,
    slotKey,
    contentType: prepared.type || "image/jpeg",
    fileName,
    base64,
  });
  onBytes(prepared.size || 1, prepared.size || 1);
  if (!result.data?.downloadUrl) {
    throw new Error("เซิร์ฟเวอร์ไม่ได้ส่งลิงก์ดูรูป");
  }
  return result.data.downloadUrl;
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
 * Canonical evidence upload — real files to Storage via Cloud Function (preferred)
 * or client SDK. Short https URLs for Firestore. No data-URL fallback.
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
      message: onlineNow()
        ? "กำลังเชื่อมต่อเซิร์ฟเวอร์อัปโหลด…"
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

    const onBytes = (transferred: number, totalBytes: number) => {
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
    };

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
      let url = "";
      // 1) Direct CF Admin upload — most reliable (bypass client Storage rules)
      try {
        url = await uploadViaCloudFunctionBytes(
          prepared,
          folderSeg,
          slotSeg,
          fileName,
          onBytes,
        );
      } catch (cfDirectErr) {
        console.warn("CF direct upload failed, trying signed URL:", cfDirectErr);
        // 2) Signed URL + XHR progress
        try {
          url = await uploadViaSignedUrl(
            prepared,
            folderSeg,
            slotSeg,
            fileName,
            onBytes,
            options.cancelRef,
          );
        } catch (signedErr) {
          console.warn("CF signed URL failed, trying client Storage:", signedErr);
          if (!isFirebaseStorageConfigured()) throw signedErr;
          // 3) Client SDK last resort
          const name = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
          const path = `${folderSeg}/${slotSeg}/${name}`;
          url = await uploadOneResumable(
            prepared,
            path,
            {
              uploadedBy: auth.currentUser.uid,
              slotKey: slotSeg,
              folder: folderSeg,
              originalName: fileName.slice(0, 120),
              evidence: "1",
            },
            onBytes,
            options.cancelRef,
            options.getCancelTask,
          );
        }
      }

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

  if (/functions\/not-found|NOT_FOUND/i.test(code + raw)) {
    return "ยังไม่มีฟังก์ชันอัปโหลดบนเซิร์ฟเวอร์ — รอ Deploy แล้วลองใหม่";
  }
  if (/unauthenticated|ยังไม่ได้เข้าสู่ระบบ/i.test(code + raw)) {
    return "ยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบก่อนแนบรูป";
  }
  if (/permission-denied|permission/i.test(code + raw)) {
    return "ไม่มีสิทธิ์อัปโหลดคลังรูป — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง";
  }
  if (/storage\/canceled|cancelled|ยกเลิก|abort/i.test(code + raw)) {
    return "ยกเลิกการอัปโหลดแล้ว";
  }
  if (/storage\/retry-limit|network|offline|Failed to fetch|timeout|หลุด/i.test(code + raw)) {
    return "เครือข่ายไม่เสถียรขณะอัปโหลด — รอสักครู่แล้วลองใหม่";
  }
  if (/storage\/quota|exceeded/i.test(code + raw)) {
    return "คลังรูปเต็มโควต้า — ติดต่อเจ้าของระบบ";
  }
  if (/เข้าสู่ระบบ|คลังรูป|ออฟไลน์|อินเทอร์เน็ต|ใหญ่เกิน|เซิร์ฟเวอร์|HTTP/.test(raw)) {
    return raw;
  }
  return raw.trim() || "อัปโหลดรูปไปคลังไม่สำเร็จ";
}

export function isRemotePhotoUrl(url: string) {
  return /^https?:\/\//i.test(url.trim());
}

/** Legacy helper (OT): Storage with tight data-URL fallback. */
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
