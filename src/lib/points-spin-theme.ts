import type { PointTier } from "./points-multiplier-spin";

/**
 * สี/ข้อความบนวงล้อ — ลุ้น「แต้มได้เพิ่ม」0–5 ไม่ใช่ของแถม และไม่ใช่ตัวคูณของแต้มฐาน
 * 0 = ไม่ได้แต้มเพิ่มจากเกม (แต้มจากบิล/สมัครยังอยู่)
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
  0: {
    points: 0,
    multiplier: 0,
    shortLabel: "+0",
    label: "ไม่ได้แต้มเพิ่ม",
    tone: "miss",
  },
  1: {
    points: 1,
    multiplier: 1,
    shortLabel: "+1",
    label: "ได้เพิ่ม 1 แต้ม",
    tone: "thai",
  },
  2: {
    points: 2,
    multiplier: 2,
    shortLabel: "+2",
    label: "ได้เพิ่ม 2 แต้ม",
    tone: "boba",
  },
  3: {
    points: 3,
    multiplier: 3,
    shortLabel: "+3",
    label: "ได้เพิ่ม 3 แต้ม",
    tone: "cookie",
  },
  4: {
    points: 4,
    multiplier: 4,
    shortLabel: "+4",
    label: "ได้เพิ่ม 4 แต้ม",
    tone: "brownie",
  },
  5: {
    points: 5,
    multiplier: 5,
    shortLabel: "+5",
    label: "ได้เพิ่ม 5 แต้ม",
    tone: "cheese",
  },
};

/** @deprecated */
export type SpinMenuPrize = SpinPointSlice;

export function prizeForPoints(p: PointTier): SpinPointSlice {
  return SPIN_MENU_PRIZES[p] ?? SPIN_MENU_PRIZES[0];
}

/** @deprecated ใช้ prizeForPoints */
export function prizeForMultiplier(m: PointTier): SpinPointSlice {
  return prizeForPoints(m);
}

export function spinResultFlavorLine(points: PointTier): string {
  if (points === 0) return "ไม่ได้แต้มเพิ่มจากเกม";
  if (points === 5) return "แจ็คพอต ได้เพิ่ม 5 แต้ม!";
  return `ได้เพิ่ม ${points} แต้ม`;
}

export const POINTS_ONLY_NOTE =
  "ลุ้นแต้มได้เพิ่ม 0–5 · ได้ +0 = ไม่ได้แต้มเพิ่มจากเกม (แต้มจากบิล/สมัครยังอยู่) · ไม่ใช่ตัวคูณ";
