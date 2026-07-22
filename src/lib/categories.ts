/** Shared expense categories for both staff ledger + owner books. */

import { canonicalLedgerType, labelLedgerType } from "./ledger-labels";

export const PNL_CATEGORIES = ["asset", "cogs", "sga"] as const;
export type PnlCategory = (typeof PNL_CATEGORIES)[number];

export type CategoryBucket = PnlCategory | "other";

/** Normalize type labels from either book into a shared PnL bucket. */
export function normalizeCategory(type: string | undefined | null): CategoryBucket {
  const key = canonicalLedgerType(type);
  if (key === "asset") return "asset";
  if (key === "cogs") return "cogs";
  if (key === "sga") return "sga";
  return "other";
}

/** Same Thai labels as staff ledger (`labelLedgerType`). */
export function categoryLabel(cat: CategoryBucket): string {
  if (cat === "asset") return labelLedgerType("asset");
  if (cat === "cogs") return labelLedgerType("cogs");
  if (cat === "sga") return labelLedgerType("sga");
  return labelLedgerType("อื่นๆ");
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
