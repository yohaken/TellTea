import { compressImageForUpload } from "@/lib/receipts";

export const MENU_SQUARE_PX = 480;
export const MENU_JPEG_QUALITY = 0.82;
/** Soft working size after auto-downscale (crop / encode input). */
export const MENU_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Absolute reject — phone photos can be 8–15MB; we auto-shrink those. */
export const MENU_MAX_RAW_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MENU_PREPROCESS_MAX_EDGE = 2048;
export const MENU_MAX_DATA_URL_CHARS = 900_000;
const SQUARE_TOLERANCE = 0.04;

export type MenuImageCropSource = {
  objectUrl: string;
  width: number;
  height: number;
};

export type PreparedMenuImage =
  | { mode: "done"; dataUrl: string }
  | { mode: "crop"; source: MenuImageCropSource };

export type SquareCropFocal = { x: number; y: number };
export type SquareCropScale = number;

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("เปิดไฟล์รูปไม่สำเร็จ"));
    img.src = url;
  });
}

export function isNearlySquare(width: number, height: number): boolean {
  if (!width || !height) return false;
  const ratio = width / height;
  return ratio >= 1 - SQUARE_TOLERANCE && ratio <= 1 + SQUARE_TOLERANCE;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Auto-shrink large phone photos before crop/encode.
 * Reuses canvas compress from receipts — no extra npm dependency.
 */
export async function preprocessMenuUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("เลือกไฟล์รูปภาพ (JPG, PNG, WebP)");
  }
  if (file.size > MENU_MAX_RAW_UPLOAD_BYTES) {
    throw new Error("ไฟล์ใหญ่เกิน 25MB — เลือกรูปอื่นหรือย่อก่อน");
  }

  let needsShrink = file.size > MENU_MAX_UPLOAD_BYTES;
  if (!needsShrink) {
    try {
      const bitmap = await createImageBitmap(file);
      needsShrink = Math.max(bitmap.width, bitmap.height) > MENU_PREPROCESS_MAX_EDGE;
      bitmap.close();
    } catch {
      needsShrink = file.size > 800_000;
    }
  }
  if (!needsShrink) return file;

  let edge = MENU_PREPROCESS_MAX_EDGE;
  let quality = 0.88;
  let current = await compressImageForUpload(file, edge, quality);
  let guard = 0;
  while (current.size > MENU_MAX_UPLOAD_BYTES && guard < 8) {
    quality = Math.max(0.5, quality - 0.08);
    edge = Math.max(640, Math.round(edge * 0.78));
    current = await compressImageForUpload(file, edge, quality);
    guard += 1;
  }
  if (current.size > MENU_MAX_UPLOAD_BYTES * 2) {
    throw new Error("บีบอัดแล้วยังใหญ่เกินไป — ลองเลือกรูปที่ชัดและใกล้ขึ้น");
  }
  return current;
}

/** Draw square cover-crop; focal is normalized center (0–1) in source image. */
export function renderSquareCoverCrop(
  img: HTMLImageElement,
  focal: SquareCropFocal,
  scaleMul: SquareCropScale = 1,
  jpegQuality = MENU_JPEG_QUALITY,
): string {
  const scale =
    Math.max(MENU_SQUARE_PX / img.width, MENU_SQUARE_PX / img.height) * Math.max(1, scaleMul);
  const cropSideSrc = MENU_SQUARE_PX / scale;
  const cx = focal.x * img.width;
  const cy = focal.y * img.height;
  const sx = clamp(cx - cropSideSrc / 2, 0, img.width - cropSideSrc);
  const sy = clamp(cy - cropSideSrc / 2, 0, img.height - cropSideSrc);

  const canvas = document.createElement("canvas");
  canvas.width = MENU_SQUARE_PX;
  canvas.height = MENU_SQUARE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("แปลงรูปไม่สำเร็จ");
  ctx.drawImage(img, sx, sy, cropSideSrc, cropSideSrc, 0, 0, MENU_SQUARE_PX, MENU_SQUARE_PX);

  let quality = jpegQuality;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > MENU_MAX_DATA_URL_CHARS && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length > MENU_MAX_DATA_URL_CHARS) {
    throw new Error("รูปยังใหญ่เกินไปหลังบีบอัด — ลองเลือกรูปอื่น");
  }
  return dataUrl;
}

export async function prepareMenuItemImage(file: File): Promise<PreparedMenuImage> {
  const ready = await preprocessMenuUpload(file);
  const objectUrl = URL.createObjectURL(ready);
  try {
    const img = await loadImageFromUrl(objectUrl);
    if (isNearlySquare(img.width, img.height)) {
      const dataUrl = renderSquareCoverCrop(img, { x: 0.5, y: 0.5 }, 1);
      URL.revokeObjectURL(objectUrl);
      return { mode: "done", dataUrl };
    }
    return {
      mode: "crop",
      source: { objectUrl, width: img.width, height: img.height },
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

export async function commitMenuItemSquareCrop(
  source: MenuImageCropSource,
  focal: SquareCropFocal,
  scaleMul: SquareCropScale,
): Promise<string> {
  const img = await loadImageFromUrl(source.objectUrl);
  return renderSquareCoverCrop(img, focal, scaleMul);
}

export function releaseMenuImageCropSource(source: MenuImageCropSource): void {
  URL.revokeObjectURL(source.objectUrl);
}

/** Auto square crop (center) — used when crop UI is skipped. */
export async function processMenuItemImage(file: File): Promise<string> {
  const prep = await prepareMenuItemImage(file);
  if (prep.mode === "done") return prep.dataUrl;
  try {
    return await commitMenuItemSquareCrop(prep.source, { x: 0.5, y: 0.5 }, 1);
  } finally {
    releaseMenuImageCropSource(prep.source);
  }
}
