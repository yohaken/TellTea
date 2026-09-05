/**
 * Match delivery-channel menu names ↔ POS (ported from scripts/lib/name-sync-match.mjs).
 */

export const STORE_ONLY_RE = /เฉพาะหน้าร้าน/;

export function normName(s: string): string {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact name compare (NBSP / extra spaces only). No fold, no similarity score. */
export function namesEqual(a: string, b: string): boolean {
  return normName(a) === normName(b);
}

/** Ignore parentheses so "ชานมไข่มุก (เย็น/ปั่น)" ≡ "ชานมไข่มุก เย็น/ปั่น". */
export function foldMenuName(s: string): string {
  return normName(s)
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStoreOnlyName(name: string): boolean {
  return STORE_ONLY_RE.test(String(name || ""));
}

/** ฟิลด์ storeOnly มีค่าก่อน — ไม่มีค่อยดูชื่อ */
export function isMenuStoreOnly(item: { name?: string; storeOnly?: boolean }): boolean {
  if (item.storeOnly === true) return true;
  if (item.storeOnly === false) return false;
  return isStoreOnlyName(item.name || "");
}

export function isHotName(s: string): boolean {
  return /ร้อน/.test(s) && !/เย็น/.test(s);
}

export function isColdName(s: string): boolean {
  return (/เย็น|ปั่น|16\s*ออนซ์/.test(s) && !/ร้อน/.test(s)) || /เย็น\/ปั่น/.test(s);
}

export function coreKey(s: string): string {
  return normName(s)
    .toLowerCase()
    .replace(/[()（）]/g, " ")
    .replace(
      /\b(flat white|cappuccino|latte|espresso|americano|long black|caramel macchiato)\b/gi,
      " ",
    )
    .replace(/กาแฟสด/g, " ")
    .replace(/\d+\s*ออนซ์/g, " ")
    .replace(/โฮมเมด/g, " ")
    .replace(/เฉพาะหน้าร้าน/g, " ")
    .replace(/ร้อน|เย็น|ปั่น/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreNames(a: string, b: string): number {
  const cg = coreKey(a);
  const cp = coreKey(b);
  if (!cg || !cp) return 0;
  let s = 0;
  if (cg === cp) s = 0.9;
  else if (cp.includes(cg) || cg.includes(cp)) s = 0.75;
  else {
    const A = new Set(cg.split(" ").filter((x) => x.length >= 2));
    const B = new Set(cp.split(" ").filter((x) => x.length >= 2));
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    if (!A.size || !B.size) return 0;
    s = inter / (A.size + B.size - inter);
  }
  if ((isHotName(a) && isHotName(b)) || (isColdName(a) && isColdName(b))) s += 0.15;
  else if ((isHotName(a) && isColdName(b)) || (isColdName(a) && isHotName(b))) s -= 0.35;
  if (/12\s*ออนซ์/.test(b) && isHotName(a)) s += 0.05;
  return s;
}

export type NamedItem = { name: string; id?: string };

/** Exact name match only (after normName). minScore is ignored. */
export function bestMatchByName<T extends NamedItem>(
  queryName: string,
  candidates: T[],
  _opts?: { minScore?: number },
): (T & { score: number }) | null {
  const exact = candidates.find((c) => namesEqual(queryName, c.name));
  return exact ? { ...exact, score: 1 } : null;
}
