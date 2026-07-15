import { uploadAppPhoto, isRemotePhotoUrl } from "./photo-upload";

/** Folder prefix in the default Storage bucket */
export const OT_PHOTO_STORAGE_PREFIX = "ot-photos";

/** Compress + upload one OT product photo (Storage with data-URL fallback). */
export async function uploadOtProductPhoto(file: File, slotKey: string): Promise<string> {
  return uploadAppPhoto(file, OT_PHOTO_STORAGE_PREFIX, slotKey, 52_000);
}

export { isRemotePhotoUrl };
