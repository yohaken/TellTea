/**
 * Menu / option label helpers — NBSP from sheets (LINE MAN / Excel) breaks search.
 */

const ODD_SPACE = /[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g;

/** Collapse weird spaces for search / compare (case-insensitive). */
export function normalizeMenuSearchText(value: string): string {
  return value
    .normalize("NFC")
    .replace(ODD_SPACE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function menuTextIncludes(haystack: string, needle: string): boolean {
  const n = normalizeMenuSearchText(needle);
  if (!n) return true;
  return normalizeMenuSearchText(haystack).includes(n);
}

/** Clean label on save — strip NBSP, keep single regular spaces. */
export function sanitizeMenuLabel(value: string): string {
  return value
    .normalize("NFC")
    .replace(ODD_SPACE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
