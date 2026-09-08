/** Shopee dish API stores prices in micros (1 baht = 100_000). Edit-page inputs are baht. */

export const SHOPEE_MICROS = 100_000;

/** Convert API micros → baht. Values already in baht (< 1000) pass through. */
export function bahtFromMicros(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return 0;
  if (n >= 1000) return Math.round(n / SHOPEE_MICROS);
  return Math.round(n);
}

export function looksLikeShopeeMicros(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1000;
}
