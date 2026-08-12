import type { MultiplierTier } from "./points-multiplier-spin";

/** สินค้าร้าน Tell Tea บนกระดาน — หายากขึ้นตามตัวคูณ */
export type SpinMenuPrize = {
  multiplier: MultiplierTier;
  /** ชื่อสั้นบนชิ้นกระดาน */
  shortLabel: string;
  /** ชื่อเต็ม */
  label: string;
  /** คลาสสีธีม */
  tone: string;
};

export const SPIN_MENU_PRIZES: Record<MultiplierTier, SpinMenuPrize> = {
  1: {
    multiplier: 1,
    shortLabel: "ชาไทย",
    label: "ชาไทย",
    tone: "thai",
  },
  2: {
    multiplier: 2,
    shortLabel: "ชานม",
    label: "ชานมไข่มุก",
    tone: "boba",
  },
  3: {
    multiplier: 3,
    shortLabel: "คุกกี้",
    label: "ซอฟคุกกี้",
    tone: "cookie",
  },
  4: {
    multiplier: 4,
    shortLabel: "บราวนี่",
    label: "บราวนี่",
    tone: "brownie",
  },
  5: {
    multiplier: 5,
    shortLabel: "ชิโอปัง",
    label: "ชิโอปัง",
    tone: "cheese",
  },
};

export function prizeForMultiplier(m: MultiplierTier): SpinMenuPrize {
  return SPIN_MENU_PRIZES[m] || SPIN_MENU_PRIZES[1];
}

export function spinResultFlavorLine(multiplier: MultiplierTier): string {
  const p = prizeForMultiplier(multiplier);
  if (multiplier === 1) return `ได้เท่าเดิม · กลิ่น${p.label}`;
  if (multiplier === 5) return `แจ็คพอต ${p.label}! คูณจัด`;
  return `หอมๆ แบบ${p.label} · คูณ ${multiplier}`;
}
