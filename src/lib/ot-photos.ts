import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirebaseAuth, getFirebaseStorage, isFirebaseStorageConfigured } from "./firebase";
import { compressImageForUpload, fileToReceiptDataUrl } from "./receipts";

/** Folder prefix in the default Storage bucket */
export const OT_PHOTO_STORAGE_PREFIX = "ot-photos";

function safeSegment(raw: string) {
  return String(raw || "x")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 48) || "x";
}

/**
 * Compress + upload one OT product photo.
 * Prefers Firebase Storage (short https URL → 10 photos fit in one doc).
 * Falls back to a tightly-compressed data URL if Storage is unavailable.
 */
export async function uploadOtProductPhoto(
  file: File,
  slotKey: string,
): Promise<string> {
  const compressed = await compressImageForUpload(file, 1280, 0.72);

  if (isFirebaseStorageConfigured()) {
    try {
      const auth = getFirebaseAuth();
      if (!auth.currentUser) {
        throw new Error("ยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบก่อนแนบรูป");
      }
      const storage = getFirebaseStorage();
      const name = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
      const path = `${OT_PHOTO_STORAGE_PREFIX}/${safeSegment(slotKey)}/${name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, compressed, {
        contentType: "image/jpeg",
        customMetadata: {
          uploadedBy: auth.currentUser.uid,
          slotKey: safeSegment(slotKey),
        },
      });
      return await getDownloadURL(storageRef);
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      // Fall through to data-URL if Storage bucket/rules not ready yet.
      if (/เข้าสู่ระบบ/.test(msg)) throw err;
      console.warn("OT Storage upload failed, falling back to data URL:", msg);
    }
  }

  // Tight budget so up to 10 photos can still live in Firestore as data URLs.
  return fileToReceiptDataUrl(compressed, 52_000);
}

export function isRemotePhotoUrl(url: string) {
  return /^https?:\/\//i.test(url.trim());
}
