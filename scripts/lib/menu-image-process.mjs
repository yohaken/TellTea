/**
 * Square JPEG data URLs for POS menu items (mirrors src/lib/pos-menu-image.ts).
 */
import sharp from "sharp";

export const MENU_SQUARE_PX = 480;
export const MENU_JPEG_QUALITY = 0.82;
export const MENU_MAX_DATA_URL_CHARS = 900_000;

/**
 * @param {string} filePath
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
export async function fileToMenuImageDataUrl(filePath) {
  let quality = Math.round(MENU_JPEG_QUALITY * 100);
  let dataUrl = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const buf = await sharp(filePath)
      .rotate()
      .resize(MENU_SQUARE_PX, MENU_SQUARE_PX, { fit: "cover", position: "centre" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
    if (dataUrl.length <= MENU_MAX_DATA_URL_CHARS) return dataUrl;
    quality = Math.max(50, quality - 10);
  }

  throw new Error(`รูปยังใหญ่เกินไปหลังลดคุณภาพ: ${filePath}`);
}
