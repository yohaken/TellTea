/**
 * เกมหมุนวงล้อได้แต้มคงที่ (0–5 แต้ม)
 * - 0 = ไม่ได้แต้มเพิ่ม (ค่าที่พบบ่อยที่สุดตามค่าเริ่ม)
 * - สัดส่วนบนวง = น้ำหนักที่ตั้ง (ปรับได้หลังร้าน)
 * - ชิ้นคะแนนเดียวกันถูกแบ่งย่อยแล้วกระจายรอบวง ไม่รวมเป็นแผงยาว
 * - ผลลัพธ์จากตำแหน่งที่หยุดหลังหน่วงตามฟิสิกส์ — ไม่สุ่มจากเปอร์เซ็นต์ล่วงหน้า
 */

export type PointTier = 0 | 1 | 2 | 3 | 4 | 5;
/** @deprecated ใช้ PointTier — คงชื่อเดิมกัน import เก่า */
export type MultiplierTier = PointTier;

export type SpinWeight = {
  /** แต้มรางวัลบนชิ้น (0–5) · 0 = ไม่ได้แต้มเพิ่ม */
  points: PointTier;
  /** สัดส่วนมุมรวมของแต้มนี้ (ไม่ต้องรวม 100) */
  weight: number;
};

/** รองรับรูปเก่า `{ multiplier, weight }` */
export type LegacySpinWeight = {
  multiplier: PointTier;
  weight: number;
};

export type SpinResult = {
  /** แต้มที่ได้จากวงล้อ (คงที่ 0–5 ไม่ใช่ตัวคูณ) */
  points: PointTier;
  /** alias = points (กันโค้ดเก่า) */
  multiplier: PointTier;
  /** แต้มฐานก่อนเล่น (บริบทอย่างเดียว — ไม่นำไปคูณ) */
  basePoints: number;
  /** แต้มรางวัลจากเกม = points */
  finalPoints: number;
  /** เท่ากับ points */
  bonusPoints: number;
};

export type WheelSlice = {
  id: string;
  points: PointTier;
  /** alias */
  multiplier: PointTier;
  startDeg: number;
  endDeg: number;
  midDeg: number;
};

function emptyTierRecord(): Record<PointTier, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/** ค่าเริ่ม: 0 แต้มมากที่สุด — ไม่บังคับ +1 ทุกครั้ง */
export const DEFAULT_SPIN_WEIGHTS: readonly SpinWeight[] = [
  { points: 0, weight: 50 },
  { points: 1, weight: 25 },
  { points: 2, weight: 12 },
  { points: 3, weight: 7 },
  { points: 4, weight: 4 },
  { points: 5, weight: 2 },
] as const;

export const POINT_TIERS: readonly PointTier[] = [0, 1, 2, 3, 4, 5];
export const MULTIPLIER_TIERS = POINT_TIERS;

function asPoints(w: SpinWeight | LegacySpinWeight): PointTier | null {
  const raw =
    "points" in w && w.points != null
      ? Number(w.points)
      : "multiplier" in w
        ? Number(w.multiplier)
        : NaN;
  if (!POINT_TIERS.includes(raw as PointTier)) return null;
  return raw as PointTier;
}

export function normalizeWeights(
  weights: readonly (SpinWeight | LegacySpinWeight)[],
): SpinWeight[] {
  const map = new Map<PointTier, number>();
  for (const t of POINT_TIERS) map.set(t, 0);
  for (const w of weights) {
    const p = asPoints(w);
    if (p == null) continue;
    const n = Number(w.weight);
    if (!(n > 0) || !Number.isFinite(n)) continue;
    map.set(p, (map.get(p) || 0) + n);
  }
  // ค่าตั้งเก่ารอบ 1–5 ไม่มีช่อง 0 — เติม 0 ให้หนาอย่างน้อยเท่าช่องที่หนาที่สุดเดิม
  if ((map.get(0) || 0) === 0) {
    const maxOther = Math.max(
      0,
      ...POINT_TIERS.filter((t) => t > 0).map((t) => map.get(t) || 0),
    );
    if (maxOther > 0) map.set(0, maxOther);
  }
  let sum = 0;
  for (const v of map.values()) sum += v;
  if (!(sum > 0)) {
    return DEFAULT_SPIN_WEIGHTS.map((w) => ({ ...w }));
  }
  return POINT_TIERS.map((points) => ({
    points,
    weight: map.get(points) || 0,
  })).filter((w) => w.weight > 0);
}

export function totalWeight(
  weights: readonly (SpinWeight | LegacySpinWeight)[],
): number {
  return normalizeWeights(weights).reduce((s, w) => s + w.weight, 0);
}

/** สัดส่วนมุมรวมต่อแต้ม (0–1) — ไม่ใช่ตัวสุ่มผล */
export function probabilityMap(
  weights: readonly (SpinWeight | LegacySpinWeight)[] = DEFAULT_SPIN_WEIGHTS,
): Record<PointTier, number> {
  const norm = normalizeWeights(weights);
  const sum = norm.reduce((s, w) => s + w.weight, 0);
  const out = emptyTierRecord();
  for (const w of norm) out[w.points] = w.weight / sum;
  return out;
}

/** ค่าคาดหวังของแต้มรางวัล */
export function expectedPoints(
  weights: readonly (SpinWeight | LegacySpinWeight)[] = DEFAULT_SPIN_WEIGHTS,
): number {
  const p = probabilityMap(weights);
  return POINT_TIERS.reduce((s, t) => s + t * p[t], 0);
}

/** @deprecated ใช้ expectedPoints */
export function expectedMultiplier(
  weights: readonly (SpinWeight | LegacySpinWeight)[] = DEFAULT_SPIN_WEIGHTS,
): number {
  return expectedPoints(weights);
}

/** จำนวนช่องบนวง — น้อยพอให้กะจังหวะได้ (เจ้าของปรับได้) */
export const WHEEL_SLICE_COUNT_MIN = 8;
export const WHEEL_SLICE_COUNT_MAX = 24;
export const DEFAULT_WHEEL_SLICE_COUNT = 12;

export function clampWheelSliceCount(n: unknown): number {
  const v = Math.trunc(Number(n) || DEFAULT_WHEEL_SLICE_COUNT);
  return Math.max(
    WHEEL_SLICE_COUNT_MIN,
    Math.min(WHEEL_SLICE_COUNT_MAX, v),
  );
}

/**
 * จำนวนชิ้นย่อยต่อแต้ม — รวมประมาณ targetSlices
 * แต้มที่มีน้ำหนักมาก = ชิ้นย่อยหลายชิ้น (จะกระจายรอบวง)
 * ค่าเริ่ม 12 ช่อง (~30°) ให้ผู้เล่นกะจังหวะได้
 */
export function allocateSliceCounts(
  weights: readonly (SpinWeight | LegacySpinWeight)[] = DEFAULT_SPIN_WEIGHTS,
  targetSlices = DEFAULT_WHEEL_SLICE_COUNT,
): Record<PointTier, number> {
  const norm = normalizeWeights(weights);
  const sum = norm.reduce((s, w) => s + w.weight, 0) || 1;
  const target = clampWheelSliceCount(targetSlices);
  const counts = emptyTierRecord();
  let assigned = 0;
  for (const w of norm) {
    const c = Math.max(1, Math.round((w.weight / sum) * target));
    counts[w.points] = c;
    assigned += c;
  }
  const active = () => POINT_TIERS.filter((t) => counts[t] > 0);
  while (assigned > target) {
    const pool = active().filter((t) => counts[t] > 1);
    if (!pool.length) break;
    pool.sort((a, b) => counts[b] - counts[a]);
    counts[pool[0]!] -= 1;
    assigned -= 1;
  }
  while (assigned < target) {
    const pool = active();
    if (!pool.length) break;
    pool.sort((a, b) => counts[b] - counts[a]);
    counts[pool[0]!] += 1;
    assigned += 1;
  }
  return counts;
}

/**
 * กระจายป้ายแต้มรอบวง — วางของหายากก่อนที่ช่องว่างสม่ำเสมอ
 * ไม่ให้ชิ้นคะแนนเดียวกันรวมเป็นแผงยาวต่อเนื่อง
 */
export function distributePointLabels(
  counts: Record<PointTier, number>,
): PointTier[] {
  const total = POINT_TIERS.reduce((s, t) => s + (counts[t] || 0), 0);
  if (total <= 0) return [0];
  const slots: Array<PointTier | null> = Array.from({ length: total }, () => null);
  const order = POINT_TIERS.filter((t) => (counts[t] || 0) > 0).sort(
    (a, b) => (counts[a] || 0) - (counts[b] || 0),
  );

  for (const tier of order) {
    const need = counts[tier] || 0;
    const free: number[] = [];
    for (let i = 0; i < total; i++) if (slots[i] == null) free.push(i);
    for (let k = 0; k < need; k++) {
      const pick = Math.floor(((k + 0.5) * free.length) / need);
      const at = Math.min(free.length - 1, Math.max(0, pick));
      const idx = free[at]!;
      slots[idx] = tier;
      free.splice(at, 1);
    }
  }
  return slots.map((s) => s ?? 0);
}

/**
 * สร้างชิ้นวงล้อ — แบ่งสัดส่วนเป็นชิ้นย่อยกระจายรอบวง
 * targetSlices น้อย = ช่องใหญ่ กะจังหวะหยุดได้
 */
export function buildWheelSlices(
  weights: readonly (SpinWeight | LegacySpinWeight)[] = DEFAULT_SPIN_WEIGHTS,
  targetSlices = DEFAULT_WHEEL_SLICE_COUNT,
): WheelSlice[] {
  const labels = distributePointLabels(
    allocateSliceCounts(weights, clampWheelSliceCount(targetSlices)),
  );
  const n = labels.length || 1;
  const span = 360 / n;
  return labels.map((points, i) => {
    const startDeg = i * span;
    const endDeg = (i + 1) * span;
    return {
      id: `s${i}-p${points}`,
      points,
      multiplier: points,
      startDeg,
      endDeg,
      midDeg: startDeg + span / 2,
    };
  });
}

/** มุมบนวงล้อ (0° = ยอดบน) ที่อยู่ใต้เข็ม เมื่อหมุน CSS rotate(rotation) ตามเข็ม */
export function pointerLocalDeg(rotationDeg: number): number {
  const r = ((rotationDeg % 360) + 360) % 360;
  return (360 - r) % 360;
}

export function sliceAtPointer(
  rotationDeg: number,
  slices: readonly WheelSlice[],
): WheelSlice {
  if (!slices.length) {
    return {
      id: "fallback",
      points: 0,
      multiplier: 0,
      startDeg: 0,
      endDeg: 360,
      midDeg: 180,
    };
  }
  const local = pointerLocalDeg(rotationDeg);
  for (const s of slices) {
    if (local >= s.startDeg && local < s.endDeg) return s;
  }
  // มุม 360 พอดี
  return slices[slices.length - 1]!;
}

export function awardSpinPoints(
  points: PointTier,
  basePoints = 0,
): SpinResult {
  const p = POINT_TIERS.includes(points) ? points : 0;
  const base = Math.max(0, Math.trunc(Number(basePoints) || 0));
  return {
    points: p,
    multiplier: p,
    basePoints: base,
    finalPoints: p,
    bonusPoints: p,
  };
}

/** @deprecated ใช้ awardSpinPoints — ไม่คูณแต้มฐานแล้ว */
export function applyMultiplier(basePoints: number, multiplier: PointTier): SpinResult {
  return awardSpinPoints(multiplier, basePoints);
}

/**
 * จำลองผลจากมุมสุ่มบนวง (เทียบเท่าโอกาสตามสัดส่วนชิ้น)
 * ไม่ใช่การสุ่ม pick แล้ว animate
 */
export function simulateSpins(
  count: number,
  weights: readonly (SpinWeight | LegacySpinWeight)[] = DEFAULT_SPIN_WEIGHTS,
  rng: () => number = Math.random,
  sliceCount = DEFAULT_WHEEL_SLICE_COUNT,
): Record<PointTier, number> {
  const n = Math.max(0, Math.min(100_000, Math.trunc(count) || 0));
  const slices = buildWheelSlices(weights, sliceCount);
  const hist = emptyTierRecord();
  for (let i = 0; i < n; i++) {
    const rot = rng() * 360;
    hist[sliceAtPointer(rot, slices).points] += 1;
  }
  return hist;
}

/** จำลองการหมุน+หน่วงแบบหยาบ — ใช้ตรวจว่ากระจายใกล้สัดส่วนมุม */
export function simulatePhysicsCoasts(
  count: number,
  weights: readonly (SpinWeight | LegacySpinWeight)[] = DEFAULT_SPIN_WEIGHTS,
  rng: () => number = Math.random,
  sliceCount = DEFAULT_WHEEL_SLICE_COUNT,
  spinSpeed = WHEEL_SPIN_SPEED,
  stopDecel = WHEEL_STOP_DECEL,
): Record<PointTier, number> {
  const n = Math.max(0, Math.min(20_000, Math.trunc(count) || 0));
  const slices = buildWheelSlices(weights, sliceCount);
  const hist = emptyTierRecord();
  const speed = Math.max(160, spinSpeed);
  const decel = Math.max(180, stopDecel);
  for (let i = 0; i < n; i++) {
    let rot = rng() * 360;
    let v = speed * (0.85 + rng() * 0.3);
    const coastAfter = rng() * 0.8;
    rot += v * coastAfter;
    let t = 0;
    while (v > WHEEL_STOP_EPS && t < 8) {
      const dt = 1 / 60;
      const a = Math.max(decel, Math.abs(v) * 0.85);
      v = Math.max(0, v - a * dt);
      rot += v * dt;
      t += dt;
    }
    hist[sliceAtPointer(rot, slices).points] += 1;
  }
  return hist;
}

export function formatPercent(p: number): string {
  if (!(p > 0)) return "0%";
  const pct = p * 100;
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct * 10) / 10}%`;
}

/** ค่าหน่วงมุมเมื่อกดหยุด (deg/s²) — ค่าเริ่มช้าลงให้กะได้ */
export const WHEEL_STOP_DECEL = 380;
/** ความเร็วหมุนขณะ "กำลังหมุน" ก่อนกดหยุด (deg/s) — ไม่เร็วเกินจนมองไม่ออก */
export const WHEEL_SPIN_SPEED = 320;
/** หยุดสนิทเมื่อช้ากว่านี้ (deg/s) */
export const WHEEL_STOP_EPS = 12;
