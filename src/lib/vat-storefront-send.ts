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

export type MonthPnlLine = { amount: number | null; pct: number | null };

export type MonthPnlStatement = {
  income: MonthPnlLine;
  cogs: MonthPnlLine;
  grossProfit: MonthPnlLine;
  otherOpex: MonthPnlLine;
  operatingProfit: MonthPnlLine;
  netVat: MonthPnlLine;
  netProfit: MonthPnlLine;
};

/** % ของรายได้ถึงร้าน · รายได้ ≤ 0 → null */
export function pctOfIncome(
  amount: number | null,
  incomeTotal: number,
): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (!Number.isFinite(incomeTotal) || incomeTotal <= 0) return null;
  return Math.round((amount / incomeTotal) * 10000) / 100;
}

/**
 * งบกำไรขาดทุนเดือน (โชว์อย่างเดียว) — แตกคชจ.บช. เป็นต้นทุนขาย / คชจ.อื่น
 * กำไรดำเนินงาน + สุทธิ ใช้ค่าจาก deriveMonthBooksView ตรง ๆ ไม่คิดใหม่
 */
export function buildMonthPnlStatement(input: {
  incomeTotal: number;
  cogs: number | null | undefined;
  booksOpex: number | null;
  monthProfit: number | null;
  netVat: number;
  profitAfterVat: number | null;
}): MonthPnlStatement {
  const income = input.incomeTotal;
  const hasBooks =
    input.booksOpex != null &&
    input.cogs != null &&
    Number.isFinite(input.cogs);
  const cogs = hasBooks ? Number(input.cogs) : null;
  const grossProfit =
    cogs == null ? null : Math.round((income - cogs) * 100) / 100;
  const otherOpex =
    cogs == null || input.booksOpex == null
      ? null
      : Math.round((input.booksOpex - cogs) * 100) / 100;
  const operatingProfit = input.monthProfit;
  const netProfit = input.profitAfterVat;
  const line = (amount: number | null): MonthPnlLine => ({
    amount,
    pct: pctOfIncome(amount, income),
  });
  return {
    income: line(income),
    cogs: line(cogs),
    grossProfit: line(grossProfit),
    otherOpex: line(otherOpex),
    operatingProfit: line(operatingProfit),
    netVat: line(input.netVat),
    netProfit: line(netProfit),
  };
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
