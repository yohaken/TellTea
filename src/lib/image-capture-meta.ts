/**
 * Capture-time forensics for evidence photos.
 * Must run on the original File BEFORE canvas re-encode (which strips EXIF).
 */

export type ImageCaptureMeta = {
  /** EXIF DateTimeOriginal / DateTime when readable (ms local-ish) */
  capturedAt: number | null;
  /** Browser File.lastModified */
  fileLastModified: number | null;
  /** Where capturedAt came from */
  captureSource: "" | "exif" | "file";
  /** SHA-256 hex of original file bytes (duplicate detection) */
  contentHash: string;
};

function parseExifAsciiDate(raw: string): number | null {
  // "YYYY:MM:DD HH:MM:SS"
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(raw || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6]);
  if (![y, mo, d, hh, mi, ss].every((n) => Number.isFinite(n))) return null;
  const t = new Date(y, mo - 1, d, hh, mi, ss).getTime();
  return Number.isFinite(t) ? t : null;
}

function readU16(view: DataView, offset: number, le: boolean) {
  return le ? view.getUint16(offset, true) : view.getUint16(offset, false);
}

function readU32(view: DataView, offset: number, le: boolean) {
  return le ? view.getUint32(offset, true) : view.getUint32(offset, false);
}

/** Minimal JPEG EXIF reader for DateTimeOriginal (0x9003) / DateTime (0x0132). */
export function readJpegExifDateMs(buf: ArrayBuffer): number | null {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    const size = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker === 0xda) break; // SOS
    if (marker === 0xe1 && size >= 8) {
      const start = offset + 4;
      const head = String.fromCharCode(...bytes.slice(start, start + 6));
      if (head.startsWith("Exif")) {
        const tiff = start + 6;
        const view = new DataView(buf, tiff);
        if (view.byteLength < 8) return null;
        const le = view.getUint16(0, false) === 0x4949;
        if (!le && view.getUint16(0, false) !== 0x4d4d) return null;
        const ifd0 = readU32(view, 4, le);
        const fromIfd = (ifdOffset: number, want: number[]): string | null => {
          if (ifdOffset <= 0 || ifdOffset + 2 > view.byteLength) return null;
          const count = readU16(view, ifdOffset, le);
          for (let i = 0; i < count; i++) {
            const entry = ifdOffset + 2 + i * 12;
            if (entry + 12 > view.byteLength) break;
            const tag = readU16(view, entry, le);
            if (!want.includes(tag)) continue;
            const type = readU16(view, entry + 2, le);
            const num = readU32(view, entry + 4, le);
            if (type !== 2 || num < 10) continue; // ASCII
            let valOff = entry + 8;
            if (num > 4) {
              valOff = readU32(view, entry + 8, le);
            }
            if (valOff + num > view.byteLength) continue;
            let s = "";
            for (let j = 0; j < num; j++) {
              const c = view.getUint8(valOff + j);
              if (c === 0) break;
              s += String.fromCharCode(c);
            }
            return s;
          }
          return null;
        };

        // IFD0 → Exif IFD pointer 0x8769
        if (ifd0 + 2 <= view.byteLength) {
          const count0 = readU16(view, ifd0, le);
          let exifIfd = 0;
          for (let i = 0; i < count0; i++) {
            const entry = ifd0 + 2 + i * 12;
            if (entry + 12 > view.byteLength) break;
            if (readU16(view, entry, le) === 0x8769) {
              exifIfd = readU32(view, entry + 8, le);
              break;
            }
          }
          if (exifIfd) {
            const original = fromIfd(exifIfd, [0x9003, 0x9004]);
            const parsed = original ? parseExifAsciiDate(original) : null;
            if (parsed) return parsed;
          }
          const fallback = fromIfd(ifd0, [0x0132]);
          const parsed = fallback ? parseExifAsciiDate(fallback) : null;
          if (parsed) return parsed;
        }
      }
    }
    offset += 2 + size;
  }
  return null;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const dig = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Extremely rare fallback — short FNV-1a style (not crypto-strong)
  const bytes = new Uint8Array(buf);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}`;
}

/** Extract capture meta from original File (call before compress). */
export async function extractImageCaptureMeta(file: File): Promise<ImageCaptureMeta> {
  const fileLastModified =
    Number(file.lastModified) > 0 && Number.isFinite(file.lastModified)
      ? Number(file.lastModified)
      : null;

  let capturedAt: number | null = null;
  let captureSource: ImageCaptureMeta["captureSource"] = "";
  let contentHash = "";

  try {
    const buf = await file.arrayBuffer();
    contentHash = await sha256Hex(buf);
    const exif = readJpegExifDateMs(buf);
    if (exif) {
      capturedAt = exif;
      captureSource = "exif";
    } else if (fileLastModified) {
      capturedAt = fileLastModified;
      captureSource = "file";
    }
  } catch {
    if (fileLastModified) {
      capturedAt = fileLastModified;
      captureSource = "file";
    }
  }

  return { capturedAt, fileLastModified, captureSource, contentHash };
}

/** Local calendar day key YYYY-MM-DD */
export function localDayKey(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Short mismatch hint vs entry business date (midnight ms).
 * Empty string = no strong signal.
 */
export function photoDateMismatchHint(
  entryDateMs: number | undefined,
  meta: { capturedAt?: number | null; uploadedAt?: number | null },
): string {
  if (!entryDateMs) return "";
  const entryDay = localDayKey(entryDateMs);
  if (!entryDay) return "";

  const cap = Number(meta.capturedAt) || 0;
  if (cap) {
    const capDay = localDayKey(cap);
    if (capDay && capDay !== entryDay) {
      return "วันถ่าย≠วันรายการ";
    }
  }

  const up = Number(meta.uploadedAt) || 0;
  if (up) {
    const upDay = localDayKey(up);
    if (upDay && upDay !== entryDay) {
      // Same-day upload of old photo won't flag here — that's OK for soft signal.
      const dayMs = 24 * 60 * 60 * 1000;
      if (Math.abs(up - entryDateMs) >= dayMs) {
        return "อัปโหลดคนละวันกับรายการ";
      }
    }
  }
  return "";
}
