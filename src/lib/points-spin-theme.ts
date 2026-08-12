import type { PointTier } from "./points-multiplier-spin";

/**
 * สี/ข้อความบนวงล้อ — ได้แต้มคงที่ 1–5 ไม่ใช่ของแถม และไม่ใช่ตัวคูณของแต้มฐาน
 */
export type SpinPointSlice = {
  points: PointTier;
  /** alias */
  multiplier: PointTier;
  shortLabel: string;
  label: string;
  tone: string;
};

export const SPIN_MENU_PRIZES: Record<PointTier, SpinPointSlice> = {
  1: { points: 1, multiplier: 1, shortLabel: "1", label: "ได้ 1 แต้ม", tone: "thai" },
  2: { points: 2, multiplier: 2, shortLabel: "2", label: "ได้ 2 แต้ม", tone: "boba" },
  3: { points: 3, multiplier: 3, shortLabel: "3", label: "ได้ 3 แต้ม", tone: "cookie" },
  4: { points: 4, multiplier: 4, shortLabel: "4", label: "ได้ 4 แต้ม", tone: "brownie" },
  5: { points: 5, multiplier: 5, shortLabel: "5", label: "ได้ 5 แต้ม", tone: "cheese" },
};

/** @deprecated */
export type SpinMenuPrize = SpinPointSlice;

export function prizeForPoints(p: PointTier): SpinPointSlice {
  return SPIN_MENU_PRIZES[p] || SPIN_MENU_PRIZES[1];
}

/** @deprecated ใช้ prizeForPoints */
export function prizeForMultiplier(m: PointTier): SpinPointSlice {
  return prizeForPoints(m);
}

export function spinResultFlavorLine(points: PointTier): string {
  if (points === 1) return "ได้ 1 แต้ม";
  if (points === 5) return "แจ็คพอต 5 แต้ม!";
  return `ได้ ${points} แต้ม`;
}

export const POINTS_ONLY_NOTE = "ได้แต้มคงที่ 1–5 · ไม่ใช่ของแถม และไม่ใช่ตัวคูณแต้มฐาน";
