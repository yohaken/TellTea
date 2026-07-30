/**
 * แถบส่งรายได้หน้าร้าน → ช่องหน้าร้านใน A) รายได้ถึงร้าน
 * แยกจาก import / GP / VAT — แค่ source × % → transfer.storefront
 */

export const SF_SEND_PCT_KEY = "telltea.vat.sfSendPct";

export function sfSendSourceKey(monthKey: string) {
  return `telltea.vat.sfSendSource.${monthKey}`;
}

export function clampSfSendPct(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** ยอดส่งเข้าตาราง = source × pct/100 (ปัดสตางค์) */
export function computeSfSendAmount(source: number, pct: number): number {
  const s = Number.isFinite(source) && source > 0 ? source : 0;
  const p = clampSfSendPct(pct);
  return Math.round(((s * p) / 100) * 100) / 100;
}

export function loadSfSendPct(): number {
  if (typeof window === "undefined") return 100;
  try {
    const raw = window.localStorage.getItem(SF_SEND_PCT_KEY);
    if (raw == null || raw === "") return 100;
    return clampSfSendPct(Number(raw));
  } catch {
    return 100;
  }
}

export function saveSfSendPct(pct: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SF_SEND_PCT_KEY, String(clampSfSendPct(pct)));
  } catch {
    /* quota / private mode */
  }
}

export function loadSfSendSource(monthKey: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(sfSendSourceKey(monthKey));
    if (raw == null || raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveSfSendSource(monthKey: string, source: number): void {
  if (typeof window === "undefined") return;
  try {
    const key = sfSendSourceKey(monthKey);
    if (!Number.isFinite(source) || source <= 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, String(source));
  } catch {
    /* ignore */
  }
}
