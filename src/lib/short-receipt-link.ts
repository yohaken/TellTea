/**
 * Compact slip QR paths on telltea-bo.
 * Long /claim and /gift URLs stay valid forever — /r/* only redirects.
 *
 * Forms:
 *   /r/c/{saleId}/{token}/  →  /claim/?s=&t=
 *   /r/g/{token}/           →  /gift/?c=
 */

export function buildShortClaimPath(saleId: string, token: string): string {
  const s = encodeURIComponent(String(saleId || "").trim());
  const t = encodeURIComponent(String(token || "").trim());
  return `/r/c/${s}/${t}/`;
}

export function buildShortGiftPath(token: string): string {
  const c = encodeURIComponent(String(token || "").trim());
  return `/r/g/${c}/`;
}

export function buildShortClaimUrl(
  saleId: string,
  token: string,
  origin: string,
): string {
  return `${origin.replace(/\/$/, "")}${buildShortClaimPath(saleId, token)}`;
}

export function buildShortGiftUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}${buildShortGiftPath(token)}`;
}

/** Resolve browser path (+ optional query) to canonical claim/gift URL. */
export function resolveShortReceiptLink(
  pathname: string,
  search = "",
): string | null {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "r") {
    if (parts[1] === "c" && parts[2] && parts[3] && !parts[4]) {
      const s = encodeURIComponent(decodeURIComponent(parts[2]));
      const t = encodeURIComponent(decodeURIComponent(parts[3]));
      return `/claim/?s=${s}&t=${t}`;
    }
    if (parts[1] === "g" && parts[2] && !parts[3]) {
      const c = encodeURIComponent(decodeURIComponent(parts[2]));
      return `/gift/?c=${c}`;
    }
  }

  const qs = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const s = (qs.get("s") || qs.get("saleId") || "").trim();
  const t = (qs.get("t") || qs.get("token") || "").trim();
  if (s && t) {
    return `/claim/?s=${encodeURIComponent(s)}&t=${encodeURIComponent(t)}`;
  }
  const g = (qs.get("g") || qs.get("c") || "").trim();
  if (g && parts[0] === "r") {
    return `/gift/?c=${encodeURIComponent(g)}`;
  }
  return null;
}
