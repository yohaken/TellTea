/** Shared expense categories for both staff ledger + owner books. */

export const PNL_CATEGORIES = ["asset", "cogs", "sga"] as const;
export type PnlCategory = (typeof PNL_CATEGORIES)[number];

export type CategoryBucket = PnlCategory | "other";

/** Normalize type labels from either book into a shared key. */
export function normalizeCategory(type: string | undefined | null): CategoryBucket {
  const raw = (type || "").trim().toLowerCase();
  if (!raw) return "other";
  if (raw === "asset" || raw === "assets") return "asset";
  if (raw === "cogs" || raw === "cosg") return "cogs";
  if (raw === "sga") return "sga";
  return "other";
}

export function categoryLabel(cat: CategoryBucket): string {
  if (cat === "asset") return "Asset";
  if (cat === "cogs") return "cogs";
  if (cat === "sga") return "sga";
  return "อื่นๆ";
}

/** Local YYYY-MM from date ms. */
export function monthKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function daysInMonthKey(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
