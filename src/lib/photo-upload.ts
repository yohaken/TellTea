import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseAuth, getFirebaseStorage, isFirebaseStorageConfigured } from "./firebase";
import { compressImageForUpload, fileToReceiptDataUrl } from "./receipts";

function safeSegment(raw: string) {
  return (
    String(raw || "x")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 48) || "x"
  );
}

const STORAGE_UPLOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Compress + upload one image for TellTea modules.
 * Prefers Firebase Storage (short https URL). Falls back to tight data URL.
 * Storage attempts are time-boxed so mobile UI never sticks on 「กำลังอัปโหลด...」.
 */
export async function uploadAppPhoto(
  file: File,
  folder: string,
  slotKey: string,
  softDataUrlChars = 52_000,
): Promise<string> {
  const compressed = await compressImageForUpload(file, 1280, 0.72);
  const folderSeg = safeSegment(folder);

  if (isFirebaseStorageConfigured()) {
    try {
      const auth = getFirebaseAuth();
      if (!auth.currentUser) {
        throw new Error("ยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบก่อนแนบรูป");
      }
      const storage = getFirebaseStorage();
      const name = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
      const path = `${folderSeg}/${safeSegment(slotKey)}/${name}`;
      const storageRef = ref(storage, path);
      await withTimeout(
        uploadBytes(storageRef, compressed, {
          contentType: "image/jpeg",
          customMetadata: {
            uploadedBy: auth.currentUser.uid,
            slotKey: safeSegment(slotKey),
            folder: folderSeg,
          },
        }),
        STORAGE_UPLOAD_TIMEOUT_MS,
        "Storage uploadBytes",
      );
      return await withTimeout(
        getDownloadURL(storageRef),
        STORAGE_UPLOAD_TIMEOUT_MS,
        "Storage getDownloadURL",
      );
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      if (/เข้าสู่ระบบ/.test(msg)) throw err;
      console.warn("Storage upload failed, falling back to data URL:", msg);
    }
  }

  return fileToReceiptDataUrl(compressed, softDataUrlChars);
}

export function isRemotePhotoUrl(url: string) {
  return /^https?:\/\//i.test(url.trim());
}
