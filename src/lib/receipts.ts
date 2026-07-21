/** บันทึกรูปลงเครื่องทันที — รองรับ iPhone (Share → บันทึกรูป) และ Android (download) */
export async function saveImageToDevice(
  file: File,
  fileName?: string,
): Promise<"shared" | "downloaded"> {
  const name = fileName || file.name || `telltea-slip-${Date.now()}.jpg`;
  const blob = file.slice(0, file.size, file.type || "image/jpeg");
  const shareFile = new File([blob], name, { type: blob.type || "image/jpeg" });

  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ files: [shareFile] }));

  if (canShare) {
    try {
      await navigator.share({
        files: [shareFile],
        title: "สลิป TellTea",
      });
      return "shared";
    } catch (err) {
      const errName = (err as Error)?.name;
      if (errName !== "AbortError") {
        // fall through to download
      } else {
        return "shared";
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
  return "downloaded";
}

/** บีบอัดรูป — เบาขึ้นบนมือถือทั้ง iOS/Android */
export async function compressImageForUpload(
  file: File,
  maxEdge = 1280,
  quality = 0.72,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg") || "slip.jpg", {
    type: "image/jpeg",
  });
}

/** Soft per-image target when packing multiple data URLs into one Firestore doc. */
export const RECEIPT_DATA_URL_SOFT_MAX = 700_000;
/** Absolute per-image ceiling (still under Firestore 1 MiB when alone). */
export const RECEIPT_DATA_URL_HARD_MAX = 900_000;

/**
 * เก็บสลิปเป็น data URL ใน Firestore (ไม่พึ่ง Firebase Storage ที่ยังไม่ได้เปิดในโปรเจค)
 * จำกัดขนาดเพื่อไม่เกินลิมิตเอกสาร
 * @param maxChars soft target length for this image (kept under hard max)
 */
export async function fileToReceiptDataUrl(
  file: File,
  maxChars: number = RECEIPT_DATA_URL_SOFT_MAX,
): Promise<string> {
  const soft = Math.min(Math.max(80_000, maxChars), RECEIPT_DATA_URL_HARD_MAX);
  let current = await compressImageForUpload(file, 1280, 0.72);
  let dataUrl = await readAsDataUrl(current);
  let quality = 0.65;
  let edge = 1100;
  while (dataUrl.length > soft && quality > 0.28) {
    current = await compressImageForUpload(file, edge, quality);
    dataUrl = await readAsDataUrl(current);
    quality -= 0.08;
    edge = Math.max(480, edge - 120);
  }
  if (dataUrl.length > RECEIPT_DATA_URL_HARD_MAX) {
    throw new Error("รูปใหญ่เกินไป — ลองถ่ายใหม่ให้ชัดและใกล้ขึ้น");
  }
  return dataUrl;
}

/** Soft target for brand logos (PNG with alpha) — keep tiny for AppShell. */
export const LOGO_DATA_URL_SOFT_MAX = 80_000;

function isPngFile(file: File) {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png") return true;
  return /\.png$/i.test(file.name || "");
}

/** Resize keeping PNG alpha — used for transparent brand marks. */
async function resizeToPngDataUrl(file: File, maxEdge: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("ไม่สามารถย่อโลโก้ได้");
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("ไม่สามารถเข้ารหัสโลโก้ PNG ได้");
  return readAsDataUrl(blob);
}

/**
 * โลโก้แบรนด์ — เก็บ PNG โปร่งใสไว้ (ไม่แปลงเป็น JPEG)
 * ไฟล์อื่น fallback เป็น JPEG แบบสลิป
 */
export async function fileToLogoDataUrl(
  file: File,
  maxChars: number = LOGO_DATA_URL_SOFT_MAX,
): Promise<string> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("ไฟล์ต้องเป็นรูปภาพ");
  }
  const soft = Math.min(Math.max(40_000, maxChars), RECEIPT_DATA_URL_HARD_MAX);

  if (isPngFile(file)) {
    // Always start from a modest edge — full-res PNGs freeze the UI when cached/fetched.
    let edge = 320;
    let dataUrl = await resizeToPngDataUrl(file, edge);
    if (dataUrl.length <= soft) return dataUrl;
    while (edge >= 96) {
      edge = Math.round(edge * 0.75);
      dataUrl = await resizeToPngDataUrl(file, edge);
      if (dataUrl.length <= soft) return dataUrl;
    }
    throw new Error("โลโก้ PNG ใหญ่เกินไป — ลดขนาดไฟล์แล้วลองใหม่");
  }

  return fileToReceiptDataUrl(file, soft);
}

/** อ่านข้อความ error จาก Firestore/เซิร์ฟเวอร์ให้เป็นภาษาไทยที่ใช้ได้จริง */
export function friendlyFirestoreWriteError(err: unknown, fallback: string): string {
  const raw =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message || "")
      : String(err || "");
  if (
    /exceeds|too (large|big)|maximum size|1\s*MiB|1048576|INVALID_ARGUMENT|longer than|ResourceExhausted|payload/i.test(
      raw,
    )
  ) {
    return "บันทึกไม่สำเร็จ — รูปใหญ่เกินไปหรือแนบหลายรูปเกินลิมิต ลองลบเหลือ 1–2 รูปแล้วบันทึกใหม่";
  }
  return raw.trim() || fallback;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}
