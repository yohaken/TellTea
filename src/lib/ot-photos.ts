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
 * Prefers Firebase Storage (short https URL → many photos fit in one doc).
 * Falls back to data URL only when Storage is not configured (dev).
 */
export async function uploadOtProductPhoto(
  file: File,
  slotKey: string,
): Promise<string> {
  const compressed = await compressImageForUpload(file, 1280, 0.72);

  if (!isFirebaseStorageConfigured()) {
    // Dev / misconfigured env — keep single-doc budget constraints elsewhere.
    return fileToReceiptDataUrl(compressed, 180_000);
  }

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
  return getDownloadURL(storageRef);
}

export function isRemotePhotoUrl(url: string) {
  return /^https?:\/\//i.test(url.trim());
}
