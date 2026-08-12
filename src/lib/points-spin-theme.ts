import type { MultiplierTier } from "./points-multiplier-spin";

/**
 * สีตกแต่งบนวงล้อ — × คือคูณแต้มเท่านั้น ไม่ใช่รางวัลสินค้า
 */
export type SpinPointSlice = {
  multiplier: MultiplierTier;
  /** ข้อความบนชิ้น (สั้น) */
  shortLabel: string;
  /** ข้อความผล */
  label: string;
  tone: string;
};

export const SPIN_MENU_PRIZES: Record<MultiplierTier, SpinPointSlice> = {
  1: { multiplier: 1, shortLabel: "×1", label: "คูณ 1 แต้ม", tone: "thai" },
  2: { multiplier: 2, shortLabel: "×2", label: "คูณ 2 แต้ม", tone: "boba" },
  3: { multiplier: 3, shortLabel: "×3", label: "คูณ 3 แต้ม", tone: "cookie" },
  4: { multiplier: 4, shortLabel: "×4", label: "คูณ 4 แต้ม", tone: "brownie" },
  5: { multiplier: 5, shortLabel: "×5", label: "คูณ 5 แต้ม", tone: "cheese" },
};

/** @deprecated ใช้ SPIN_MENU_PRIZES — คงชื่อเดิมกันเทสเก่าพัง */
export type SpinMenuPrize = SpinPointSlice;

export function prizeForMultiplier(m: MultiplierTier): SpinPointSlice {
  return SPIN_MENU_PRIZES[m] || SPIN_MENU_PRIZES[1];
}

export function spinResultFlavorLine(multiplier: MultiplierTier): string {
  if (multiplier === 1) return "ได้แต้มเท่าเดิม";
  if (multiplier === 5) return "แจ็คพอตคูณแต้ม!";
  return `คูณแต้ม ×${multiplier}`;
}

export const POINTS_ONLY_NOTE = "× คือคูณแต้มเท่านั้น · ไม่ใช่ของแถมหรือสินค้า";
