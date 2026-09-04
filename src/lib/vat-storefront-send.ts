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

function normalizeSource(source: number): number {
  return Number.isFinite(source) && source > 0 ? source : 0;
}

/** ยอดส่งเข้าตาราง = source × pct/100 (ปัดสตางค์) */
export function computeSfSendAmount(source: number, pct: number): number {
  const s = normalizeSource(source);
  const p = clampSfSendPct(pct);
  if (p <= 0 || s <= 0) return 0;
  return Math.round(((s * p) / 100) * 100) / 100;
}

/** ส่วนหน้าร้านที่ไม่ถูกส่ง = source − ยอดส่ง */
export function computeSfUnsentAmount(source: number, pct: number): number {
  const s = normalizeSource(source);
  const sent = computeSfSendAmount(s, pct);
  return Math.round((s - sent) * 100) / 100;
}

/**
 * กำไรจริง (ดูเอง) = กำไรสุทธิหลัง VAT + ส่วนหน้าร้านที่ไม่ถูกส่ง
 * ไม่แตะสูตร VAT / ภ.ง.ด. / P&L
 */
export function computeRealProfitAfterVat(
  profitAfterVat: number | null,
  unsentStorefront: number,
): number | null {
  if (profitAfterVat == null || !Number.isFinite(profitAfterVat)) return null;
  const u =
    Number.isFinite(unsentStorefront) && unsentStorefront > 0
      ? unsentStorefront
      : 0;
  return Math.round((profitAfterVat + u) * 100) / 100;
}

/** อัตรากำไรสุทธิ % เทียบรายได้ถึงร้าน */
export function computeNetProfitMarginPct(
  profitAfterVat: number | null,
  incomeTotal: number,
): number | null {
  if (profitAfterVat == null || !Number.isFinite(profitAfterVat)) return null;
  if (!Number.isFinite(incomeTotal) || incomeTotal <= 0) return null;
  return Math.round((profitAfterVat / incomeTotal) * 10000) / 100;
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
