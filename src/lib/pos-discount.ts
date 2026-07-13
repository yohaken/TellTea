/** Cart-level discount helpers — baht or percent, rounded to satang. */

export type PosCartDiscount =
  | { kind: "baht"; value: number }
  | { kind: "percent"; value: number };

export function resolveDiscountBaht(subtotal: number, discount: PosCartDiscount | null): number {
  const base = Math.round(Math.max(0, subtotal) * 100) / 100;
  if (!discount || !(discount.value > 0) || base <= 0) return 0;
  if (discount.kind === "baht") {
    return Math.min(Math.round(discount.value * 100) / 100, base);
  }
  const pct = Math.min(100, Math.max(0, discount.value));
  return Math.min(Math.round((base * pct) / 100 * 100) / 100, base);
}

export function payableAfterDiscount(subtotal: number, discount: PosCartDiscount | null): number {
  const base = Math.round(Math.max(0, subtotal) * 100) / 100;
  const cut = resolveDiscountBaht(base, discount);
  return Math.round((base - cut) * 100) / 100;
}

export function normalizeDiscountBaht(raw: unknown, subtotal: number): number {
  const n = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(n) || n <= 0) return 0;
  const base = Math.round(Math.max(0, subtotal) * 100) / 100;
  return Math.min(n, base);
}
