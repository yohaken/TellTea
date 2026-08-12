/**
 * เกมหมุนกระดานคูณแต้ม (×1–×5)
 * ความกว้างชิ้นบนกระดาน = น้ำหนักสุ่ม — ×5 แคบสุด
 */

export type MultiplierTier = 1 | 2 | 3 | 4 | 5;

export type SpinWeight = {
  multiplier: MultiplierTier;
  /** สัดส่วนความกว้าง / ความน่าจะเป็น (ไม่ต้องรวม 100) */
  weight: number;
};

export type SpinBoardSegment = {
  id: string;
  multiplier: MultiplierTier;
  /** สัดส่วนความกว้างสัมพัทธ์ */
  width: number;
  /** จุดกึ่งกลางในหน่วยความกว้างสะสม (0..totalWidth) */
  center: number;
  start: number;
  end: number;
};

export type SpinResult = {
  multiplier: MultiplierTier;
  basePoints: number;
  /** แต้มหลังคูณ (ปัดลง) */
  finalPoints: number;
  /** แต้มโบนัส = final − base */
  bonusPoints: number;
};

/** ค่าเริ่ม: EV ≈ 1.75 — ×5 หายาก */
export const DEFAULT_SPIN_WEIGHTS: readonly SpinWeight[] = [
  { multiplier: 1, weight: 50 },
  { multiplier: 2, weight: 28 },
  { multiplier: 3, weight: 14 },
  { multiplier: 4, weight: 6 },
  { multiplier: 5, weight: 2 },
] as const;

export const MULTIPLIER_TIERS: readonly MultiplierTier[] = [1, 2, 3, 4, 5];

export function normalizeWeights(weights: readonly SpinWeight[]): SpinWeight[] {
  const map = new Map<MultiplierTier, number>();
  for (const t of MULTIPLIER_TIERS) map.set(t, 0);
  for (const w of weights) {
    if (!MULTIPLIER_TIERS.includes(w.multiplier)) continue;
    const n = Number(w.weight);
    if (!(n > 0) || !Number.isFinite(n)) continue;
    map.set(w.multiplier, (map.get(w.multiplier) || 0) + n);
  }
  // กันพัง: ถ้าทุกอัน 0 ใช้ค่าเริ่ม
  let sum = 0;
  for (const v of map.values()) sum += v;
  if (!(sum > 0)) {
    return DEFAULT_SPIN_WEIGHTS.map((w) => ({ ...w }));
  }
  return MULTIPLIER_TIERS.map((m) => ({
    multiplier: m,
    weight: map.get(m) || 0,
  })).filter((w) => w.weight > 0);
}

export function totalWeight(weights: readonly SpinWeight[]): number {
  return normalizeWeights(weights).reduce((s, w) => s + w.weight, 0);
}

/** ความน่าจะเป็นต่อขั้น (0–1) */
export function probabilityMap(
  weights: readonly SpinWeight[] = DEFAULT_SPIN_WEIGHTS,
): Record<MultiplierTier, number> {
  const norm = normalizeWeights(weights);
  const sum = norm.reduce((s, w) => s + w.weight, 0);
  const out: Record<MultiplierTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const w of norm) out[w.multiplier] = w.weight / sum;
  return out;
}

/** ค่าคาดหวังของตัวคูณ */
export function expectedMultiplier(
  weights: readonly SpinWeight[] = DEFAULT_SPIN_WEIGHTS,
): number {
  const p = probabilityMap(weights);
  return MULTIPLIER_TIERS.reduce((s, m) => s + m * p[m], 0);
}

export function pickMultiplier(
  weights: readonly SpinWeight[] = DEFAULT_SPIN_WEIGHTS,
  rng: () => number = Math.random,
): MultiplierTier {
  const norm = normalizeWeights(weights);
  const sum = norm.reduce((s, w) => s + w.weight, 0);
  let r = rng() * sum;
  if (!(r >= 0) || !Number.isFinite(r)) r = 0;
  for (const w of norm) {
    r -= w.weight;
    if (r < 0) return w.multiplier;
  }
  return norm[norm.length - 1]?.multiplier ?? 1;
}

export function applyMultiplier(basePoints: number, multiplier: MultiplierTier): SpinResult {
  const base = Math.max(0, Math.trunc(Number(basePoints) || 0));
  const mult = MULTIPLIER_TIERS.includes(multiplier) ? multiplier : 1;
  const finalPoints = base * mult;
  return {
    multiplier: mult,
    basePoints: base,
    finalPoints,
    bonusPoints: Math.max(0, finalPoints - base),
  };
}

/**
 * สร้างชิ้นกระดานตามน้ำหนัก — ทำซ้ำหลายรอบให้เลื่อนยาวๆ
 * ความกว้างชิ้น = weight (×5 แคบ)
 */
export function buildBoardSegments(
  weights: readonly SpinWeight[] = DEFAULT_SPIN_WEIGHTS,
  repeats = 4,
): SpinBoardSegment[] {
  const norm = normalizeWeights(weights);
  const reps = Math.max(1, Math.min(12, Math.trunc(repeats) || 1));
  const out: SpinBoardSegment[] = [];
  let cursor = 0;
  for (let r = 0; r < reps; r++) {
    for (const w of norm) {
      const start = cursor;
      const end = cursor + w.weight;
      out.push({
        id: `${r}-${w.multiplier}-${start}`,
        multiplier: w.multiplier,
        width: w.weight,
        start,
        end,
        center: (start + end) / 2,
      });
      cursor = end;
    }
  }
  return out;
}

export function boardTotalWidth(segments: readonly SpinBoardSegment[]): number {
  if (!segments.length) return 1;
  return segments[segments.length - 1]!.end;
}

/** หาชิ้นเป้าหมายรอบกลางกระดานสำหรับแอนิเมชันหยุด */
export function pickTargetSegment(
  segments: readonly SpinBoardSegment[],
  multiplier: MultiplierTier,
): SpinBoardSegment {
  const matches = segments.filter((s) => s.multiplier === multiplier);
  if (!matches.length) {
    return segments[Math.floor(segments.length / 2)] || {
      id: "fallback",
      multiplier: 1,
      width: 1,
      start: 0,
      end: 1,
      center: 0.5,
    };
  }
  // เลือกชิ้นช่วงกลางๆ ของแถบ เพื่อมีที่ให้หมุนเข้า
  const idx = Math.floor(matches.length * 0.55);
  return matches[Math.min(matches.length - 1, Math.max(0, idx))]!;
}

/** ชิ้นบนวงล้อกลม — มุมตามน้ำหนัก (0° = ยอดบน หมุนตามเข็ม) */
export type WheelSlice = {
  multiplier: MultiplierTier;
  startDeg: number;
  endDeg: number;
  midDeg: number;
  weight: number;
};

export function buildWheelSlices(
  weights: readonly SpinWeight[] = DEFAULT_SPIN_WEIGHTS,
): WheelSlice[] {
  const norm = normalizeWeights(weights);
  const sum = norm.reduce((s, w) => s + w.weight, 0) || 1;
  let cursor = 0;
  return norm.map((w) => {
    const span = (w.weight / sum) * 360;
    const startDeg = cursor;
    const endDeg = cursor + span;
    cursor = endDeg;
    return {
      multiplier: w.multiplier,
      startDeg,
      endDeg,
      midDeg: (startDeg + endDeg) / 2,
      weight: w.weight,
    };
  });
}

/** มุมหมุนวงล้อ (ตามเข็ม) ให้ mid ของชิ้นอยู่ใต้เข็มที่ยอดบน */
export function wheelTargetRotation(midDeg: number, extraSpins = 5): number {
  const spins = Math.max(3, Math.min(10, Math.trunc(extraSpins) || 5));
  const align = (360 - (midDeg % 360) + 360) % 360;
  return spins * 360 + align;
}

/** จำลอง N ครั้ง — ใช้ดูสัดส่วนในหลังร้าน */
export function simulateSpins(
  count: number,
  weights: readonly SpinWeight[] = DEFAULT_SPIN_WEIGHTS,
  rng: () => number = Math.random,
): Record<MultiplierTier, number> {
  const n = Math.max(0, Math.min(100_000, Math.trunc(count) || 0));
  const hist: Record<MultiplierTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let i = 0; i < n; i++) {
    hist[pickMultiplier(weights, rng)] += 1;
  }
  return hist;
}

export function formatPercent(p: number): string {
  if (!(p > 0)) return "0%";
  const pct = p * 100;
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct * 10) / 10}%`;
}
