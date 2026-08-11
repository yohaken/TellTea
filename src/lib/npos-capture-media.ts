/** Cloud Function that streams capture JPEGs via Admin (avoids Storage 412). */
export const NPOS_CAPTURE_MEDIA_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposCaptureMedia";

export type NposCaptureRole = "primary" | "secondary" | "slip";

export function nposCaptureMediaUrl(
  shotId: string | undefined | null,
  role: NposCaptureRole,
): string {
  const id = String(shotId || "").trim();
  if (!id) return "";
  const r = role === "secondary" || role === "slip" ? role : "primary";
  return `${NPOS_CAPTURE_MEDIA_URL}?id=${encodeURIComponent(id)}&role=${r}`;
}

/**
 * Prefer media-proxy URL when this role actually has an image (non-empty storedUrl).
 * Never invent a proxy URL from shotId alone — empty roles 404 and look like
 * 「โหลดรูปไม่สำเร็จ」 even when the other role succeeded.
 * Skip bare Firebase token URLs — they 412 on the project OT bucket.
 */
export function resolveNposCaptureDisplayUrl(opts: {
  shotId?: string | null;
  role: NposCaptureRole;
  storedUrl?: string | null;
}): string {
  const stored = String(opts.storedUrl || "").trim();
  if (!stored) return "";
  const proxy = nposCaptureMediaUrl(opts.shotId, opts.role);
  if (proxy) return proxy;
  if (stored.includes("nposCaptureMedia")) return stored;
  if (stored.includes("storage.googleapis.com") && stored.includes("X-Goog-")) return stored;
  // Known-broken for this project: firebasestorage.googleapis.com …&token=
  if (stored.includes("firebasestorage.googleapis.com") && stored.includes("token=")) {
    return "";
  }
  return stored;
}
