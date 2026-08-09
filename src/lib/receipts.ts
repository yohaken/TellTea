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

export type CompressImageOptions = {
  /** Cap on the longer side (default = maxEdge arg). */
  maxLongEdge?: number;
  /** Cap on the shorter side — keeps thermal receipt width readable. */
  maxShortEdge?: number;
};

/** บีบอัดรูป — เบาขึ้นบนมือถือทั้ง iOS/Android */
export async function compressImageForUpload(
  file: File,
  maxEdge = 1280,
  quality = 0.72,
  opts?: CompressImageOptions,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const maxLong = Math.max(1, opts?.maxLongEdge ?? maxEdge);
  const maxShort = Math.max(1, opts?.maxShortEdge ?? maxEdge);
  const short = Math.min(bitmap.width, bitmap.height);
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, maxLong / long, maxShort / short);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
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
 * ใบเสร็จยาว (ท็อปเวิลด์ ฯลฯ): รักษาด้านสั้นให้อ่าน VAT ท้ายบิลได้ — ลดคุณภาพก่อนย่อด้านสั้น
 * @param maxChars soft target length for this image (kept under hard max)
 */
export async function fileToReceiptDataUrl(
  file: File,
  maxChars: number = RECEIPT_DATA_URL_SOFT_MAX,
): Promise<string> {
  const soft = Math.min(Math.max(80_000, maxChars), RECEIPT_DATA_URL_HARD_MAX);
  // Prefer readable thermal text: keep short edge high, allow taller long edge.
  let longEdge = 2400;
  let shortEdge = 1400;
  let quality = 0.86;
  let current = await compressImageForUpload(file, longEdge, quality, {
    maxLongEdge: longEdge,
    maxShortEdge: shortEdge,
  });
  let dataUrl = await readAsDataUrl(current);
  while (dataUrl.length > soft && quality > 0.55) {
    quality = Math.max(0.55, quality - 0.06);
    current = await compressImageForUpload(file, longEdge, quality, {
      maxLongEdge: longEdge,
      maxShortEdge: shortEdge,
    });
    dataUrl = await readAsDataUrl(current);
  }
  while (dataUrl.length > soft && longEdge > 1400) {
    longEdge = Math.max(1400, longEdge - 200);
    shortEdge = Math.max(900, shortEdge - 80);
    current = await compressImageForUpload(file, longEdge, quality, {
      maxLongEdge: longEdge,
      maxShortEdge: shortEdge,
    });
    dataUrl = await readAsDataUrl(current);
  }
  while (dataUrl.length > soft && (quality > 0.32 || shortEdge > 640)) {
    if (quality > 0.32) quality = Math.max(0.32, quality - 0.06);
    else {
      longEdge = Math.max(960, longEdge - 160);
      shortEdge = Math.max(640, shortEdge - 80);
    }
    current = await compressImageForUpload(file, longEdge, quality, {
      maxLongEdge: longEdge,
      maxShortEdge: shortEdge,
    });
    dataUrl = await readAsDataUrl(current);
  }
  if (dataUrl.length > RECEIPT_DATA_URL_HARD_MAX) {
    throw new Error("รูปใหญ่เกินไป — ลองถ่ายใหม่ให้ชัดและใกล้ขึ้น");
  }
  return dataUrl;
}

/** Soft target for brand logos (PNG with alpha) — keep tiny for AppShell. */
export const LOGO_DATA_URL_SOFT_MAX = 80_000;

/**
 * Near-white / cream / light gray pad — รวมตารางหมากรุก “โปร่งใส” ที่ถูก bake ลง PNG
 * (Photoshop/Figma checkerboard: #fff + #ccc) ซึ่งไม่ใช่ alpha จริง
 * ไม่กินโลโก้สีเข้ม/สีอิ่มตัว (เช่น กรมท่า Tell Tea)
 */
export function isLogoKnockoutRgb(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  const chroma = max - min;
  // White / cream phone-export pad
  if (avg >= 205 && chroma <= 60) return true;
  // Neutral greys from transparency-grid tiles (#bbb–#e8e8e8)
  if (avg >= 155 && avg <= 245 && chroma <= 22) return true;
  return false;
}

/**
 * Flood-fill from edges: turn connected light / checkerboard pixels transparent.
 * Keeps ink inside the mark (not edge-connected) — e.g. navy Tell Tea logo.
 */
export function knockOutLogoLightBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): boolean {
  if (w <= 0 || h <= 0) return false;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  let cleared = 0;

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i]) return;
    const o = i * 4;
    if (d[o + 3] < 12) {
      seen[i] = 1;
      return;
    }
    if (!isLogoKnockoutRgb(d[o], d[o + 1], d[o + 2])) return;
    seen[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }

  while (stack.length) {
    const i = stack.pop()!;
    const o = i * 4;
    d[o + 3] = 0;
    cleared += 1;
    const x = i % w;
    const y = (i / w) | 0;
    // 8-connected so checkerboard whites/greys stay one component
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
    tryPush(x + 1, y + 1);
    tryPush(x - 1, y - 1);
    tryPush(x + 1, y - 1);
    tryPush(x - 1, y + 1);
  }

  if (!cleared) return false;
  ctx.putImageData(img, 0, 0);
  return true;
}

/** Sync PNG encode — toBlob callbacks can hang forever on some mobile WebViews. */
function canvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  try {
    const out = canvas.toDataURL("image/png");
    if (!out.startsWith("data:image/png")) {
      throw new Error("ไม่สามารถเข้ารหัสโลโก้ PNG ได้");
    }
    return out;
  } catch {
    throw new Error("ไม่สามารถเข้ารหัสโลโก้ PNG ได้");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
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

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("อ่านโลโก้ไม่สำเร็จ"));
    el.src = src;
  });
}

type DrawableImage = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close?: () => void;
};

/** Decode file for canvas — bitmap first, object-URL image fallback (iOS HEIC/WebView). */
async function decodeImageFile(file: File): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await withTimeout(
        createImageBitmap(file),
        12_000,
        "อ่านรูปนานเกินไป — ลองเป็น PNG หรือ JPG",
      );
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      /* fall through */
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await withTimeout(
      loadHtmlImage(objectUrl),
      12_000,
      "อ่านรูปนานเกินไป — ลองเป็น PNG หรือ JPG",
    );
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Resize any image to PNG + knock out light edge background. */
async function resizeToPngDataUrl(file: File, maxEdge: number): Promise<string> {
  const source = await decodeImageFile(file);
  try {
    const sw = Math.max(1, source.width);
    const sh = Math.max(1, source.height);
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("ไม่สามารถย่อโลโก้ได้");
    ctx.clearRect(0, 0, w, h);
    source.draw(ctx, w, h);
    knockOutLogoLightBackground(ctx, w, h);
    return canvasToPngDataUrl(canvas);
  } finally {
    source.close?.();
  }
}

/**
 * Re-encode a stored logo data URL as PNG with light edge pad removed.
 * Safe for already-uploaded JPEG/PNG marks that show white corners on login.
 */
export async function prepareBrandLogoPngDataUrl(
  dataUrl: string,
  maxEdge = 320,
): Promise<string> {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/")) return raw;
  // Fresh uploads from fileToLogoDataUrl are already PNG + knockout under the soft cap.
  if (raw.startsWith("data:image/png") && raw.length <= LOGO_DATA_URL_SOFT_MAX) {
    return raw;
  }

  const img = await withTimeout(
    loadHtmlImage(raw),
    12_000,
    "แปลงโลโก้นานเกินไป — ลองไฟล์เล็กกว่าหรือเป็น PNG",
  );

  const nw = img.naturalWidth || maxEdge;
  const nh = img.naturalHeight || maxEdge;
  const scale = Math.min(1, maxEdge / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("ไม่สามารถย่อโลโก้ได้");
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  knockOutLogoLightBackground(ctx, w, h);
  return canvasToPngDataUrl(canvas);
}

/**
 * โลโก้แบรนด์ — เก็บ PNG โปร่งใส · ตัดพื้นขาว/ครีมที่ขอบตอนอัปโหลด
 * (JPEG เดิมทำให้มีแถบขาวบนพื้นเขียวหน้าล็อกอิน)
 */
export async function fileToLogoDataUrl(
  file: File,
  maxChars: number = LOGO_DATA_URL_SOFT_MAX,
): Promise<string> {
  const mime = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  if (mime.includes("heic") || mime.includes("heif") || /\.heic$|\.heif$/i.test(name)) {
    throw new Error("ยังไม่รองรับ HEIC — บันทึกเป็น JPG หรือ PNG แล้วลองใหม่");
  }
  if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream") {
    throw new Error("ไฟล์ต้องเป็นรูปภาพ");
  }
  const soft = Math.min(Math.max(40_000, maxChars), RECEIPT_DATA_URL_HARD_MAX);

  // Always PNG + knockout — never bake a white square via JPEG.
  let edge = 320;
  let dataUrl = await resizeToPngDataUrl(file, edge);
  if (dataUrl.length <= soft) return dataUrl;
  while (edge >= 96) {
    edge = Math.round(edge * 0.75);
    dataUrl = await resizeToPngDataUrl(file, edge);
    if (dataUrl.length <= soft) return dataUrl;
  }
  throw new Error("โลโก้ใหญ่เกินไป — ลดขนาดไฟล์แล้วลองใหม่");
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
  if (
    /missing or insufficient permissions|permission-denied|PERMISSION_DENIED/i.test(
      raw,
    )
  ) {
    return (
      "บันทึกไม่สำเร็จ — สิทธิ์ไม่พอหรือเซสชันหลุด · ลองออกแล้วเข้าใหม่ · " +
      "ลงยอดย้อนหลังได้ถ้าเดือนยังไม่ปิดโบนัส"
    );
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
