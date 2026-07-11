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

/**
 * เก็บสลิปเป็น data URL ใน Firestore (ไม่พึ่ง Firebase Storage ที่ยังไม่ได้เปิดในโปรเจค)
 * จำกัดขนาดเพื่อไม่เกินลิมิตเอกสาร
 */
export async function fileToReceiptDataUrl(file: File): Promise<string> {
  let current = await compressImageForUpload(file, 1280, 0.72);
  let dataUrl = await readAsDataUrl(current);
  let quality = 0.65;
  let edge = 1100;
  while (dataUrl.length > 700_000 && quality > 0.35) {
    current = await compressImageForUpload(file, edge, quality);
    dataUrl = await readAsDataUrl(current);
    quality -= 0.1;
    edge -= 150;
  }
  if (dataUrl.length > 900_000) {
    throw new Error("รูปใหญ่เกินไป — ลองถ่ายใหม่ให้ชัดและใกล้ขึ้น");
  }
  return dataUrl;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}
