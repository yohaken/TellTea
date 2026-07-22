/** Cloud Function that streams capture JPEGs via Admin (avoids Storage 412). */
export const NPOS_CAPTURE_MEDIA_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposCaptureMedia";

export function nposCaptureMediaUrl(
  shotId: string | undefined | null,
  role: "primary" | "secondary",
): string {
  const id = String(shotId || "").trim();
  if (!id) return "";
  return `${NPOS_CAPTURE_MEDIA_URL}?id=${encodeURIComponent(id)}&role=${role}`;
}

/**
 * Prefer media-proxy URL when we have shotId. Fall back to stored URL only if it
 * is already a proxy URL (or signed GCS). Skip bare Firebase token URLs — they
 * 412 on the project OT bucket and show blank thumbs in BO.
 */
export function resolveNposCaptureDisplayUrl(opts: {
  shotId?: string | null;
  role: "primary" | "secondary";
  storedUrl?: string | null;
}): string {
  const proxy = nposCaptureMediaUrl(opts.shotId, opts.role);
  if (proxy) return proxy;
  const stored = String(opts.storedUrl || "").trim();
  if (!stored) return "";
  if (stored.includes("nposCaptureMedia")) return stored;
  if (stored.includes("storage.googleapis.com") && stored.includes("X-Goog-")) return stored;
  // Known-broken for this project: firebasestorage.googleapis.com …&token=
  if (stored.includes("firebasestorage.googleapis.com") && stored.includes("token=")) {
    return "";
  }
  return stored;
}
