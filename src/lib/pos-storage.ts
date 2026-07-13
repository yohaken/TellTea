import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { getPosFirebaseApp } from "./pos-firebase";

const MAX_BYTES = 2 * 1024 * 1024;

let storage: ReturnType<typeof getStorage> | undefined;

export function getPosStorage() {
  if (!storage) storage = getStorage(getPosFirebaseApp());
  return storage;
}

/** Upload menu item photo — returns public download URL. */
export async function uploadPosMenuItemImage(itemId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("เลือกไฟล์รูปภาพ (JPG, PNG, WebP)");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("รูปใหญ่เกิน 2MB — ลดขนาดแล้วลองใหม่");
  }
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `pos-menu/${itemId}/${Date.now()}.${ext}`;
  const storageRef = ref(getPosStorage(), path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}
