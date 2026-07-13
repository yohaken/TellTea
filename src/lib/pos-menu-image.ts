const MAX_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 480;
const JPEG_QUALITY = 0.82;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("เปิดไฟล์รูปไม่สำเร็จ"));
    };
    img.src = url;
  });
}

/** Resize + compress menu photo → data URL for Firestore (no Storage bucket required). */
export async function processMenuItemImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("เลือกไฟล์รูปภาพ (JPG, PNG, WebP)");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("รูปใหญ่เกิน 2MB — ลดขนาดแล้วลองใหม่");
  }

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("แปลงรูปไม่สำเร็จ");
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (dataUrl.length > 900_000) {
    throw new Error("รูปยังใหญ่เกินไป — ลดความละเอียดแล้วลองใหม่");
  }
  return dataUrl;
}
