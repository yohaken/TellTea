/**
 * ค่าตั้งเกมหมุนวงล้อ — เจ้าของปรับได้ที่ /members/spin-demo/
 * เก็บที่ meta/pointsSpinSettings
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  DEFAULT_SPIN_WEIGHTS,
  DEFAULT_WHEEL_SLICE_COUNT,
  POINT_TIERS,
  WHEEL_SLICE_COUNT_MAX,
  WHEEL_SLICE_COUNT_MIN,
  WHEEL_SPIN_SPEED,
  WHEEL_STOP_DECEL,
  clampWheelSliceCount,
  normalizeWeights,
  type PointTier,
  type SpinWeight,
} from "@/lib/points-multiplier-spin";

export const POINTS_SPIN_SETTINGS_DOC = "pointsSpinSettings";

export {
  WHEEL_SLICE_COUNT_MIN as SLICE_COUNT_MIN,
  WHEEL_SLICE_COUNT_MAX as SLICE_COUNT_MAX,
  DEFAULT_WHEEL_SLICE_COUNT as DEFAULT_SLICE_COUNT,
};

export type PointsSpinSettings = {
  /** จำนวนชิ้นบนวงล้อ (8–24) — น้อย = ช่องใหญ่ กะได้ */
  sliceCount: number;
  /** สัดส่วนมุมรวมของแต้ม 1–5 */
  weights: SpinWeight[];
  /** ความเร็วหมุนก่อนกดหยุด (deg/s) */
  spinSpeed: number;
  /** ความหน่วงตอนกดหยุด (deg/s²) */
  stopDecel: number;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_POINTS_SPIN_SETTINGS: PointsSpinSettings = {
  sliceCount: DEFAULT_WHEEL_SLICE_COUNT,
  weights: DEFAULT_SPIN_WEIGHTS.map((w) => ({ ...w })),
  spinSpeed: WHEEL_SPIN_SPEED,
  stopDecel: WHEEL_STOP_DECEL,
  updatedAt: 0,
  updatedBy: "",
};

export function clampSpinSpeed(n: unknown): number {
  const v = Number(n);
  if (!(v > 0) || !Number.isFinite(v)) return DEFAULT_POINTS_SPIN_SETTINGS.spinSpeed;
  return Math.max(160, Math.min(640, Math.round(v)));
}

export function clampStopDecel(n: unknown): number {
  const v = Number(n);
  if (!(v > 0) || !Number.isFinite(v)) return DEFAULT_POINTS_SPIN_SETTINGS.stopDecel;
  return Math.max(180, Math.min(900, Math.round(v)));
}

export function normalizeSpinSettings(
  raw: Partial<PointsSpinSettings> | Record<string, unknown> | null | undefined,
): PointsSpinSettings {
  const data = (raw || {}) as Partial<PointsSpinSettings> & {
    weights?: unknown;
  };
  let weightsIn: SpinWeight[] = DEFAULT_SPIN_WEIGHTS.map((w) => ({ ...w }));
  if (Array.isArray(data.weights)) {
    weightsIn = data.weights as SpinWeight[];
  }
  return {
    sliceCount: clampWheelSliceCount(data.sliceCount),
    weights: normalizeWeights(weightsIn),
    spinSpeed: clampSpinSpeed(data.spinSpeed ?? WHEEL_SPIN_SPEED),
    stopDecel: clampStopDecel(data.stopDecel ?? WHEEL_STOP_DECEL),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
  };
}

function settingsRef() {
  return doc(getDb(), "meta", POINTS_SPIN_SETTINGS_DOC);
}

export async function loadPointsSpinSettings(): Promise<PointsSpinSettings> {
  try {
    const snap = await getDoc(settingsRef());
    if (!snap.exists()) return { ...DEFAULT_POINTS_SPIN_SETTINGS };
    return normalizeSpinSettings(snap.data() as Record<string, unknown>);
  } catch {
    return { ...DEFAULT_POINTS_SPIN_SETTINGS };
  }
}

export async function savePointsSpinSettings(
  patch: Partial<PointsSpinSettings>,
  actorId: string,
): Promise<PointsSpinSettings> {
  const current = await loadPointsSpinSettings();
  const next = normalizeSpinSettings({
    ...current,
    ...patch,
    weights: patch.weights ?? current.weights,
    updatedAt: Date.now(),
    updatedBy: actorId || current.updatedBy || "",
  });
  await setDoc(
    settingsRef(),
    {
      sliceCount: next.sliceCount,
      weights: next.weights.map((w) => ({ points: w.points, weight: w.weight })),
      spinSpeed: next.spinSpeed,
      stopDecel: next.stopDecel,
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
    },
    { merge: true },
  );
  return next;
}

export function weightMap(settings: PointsSpinSettings): Record<PointTier, number> {
  const out: Record<PointTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const t of POINT_TIERS) out[t] = 0;
  for (const w of settings.weights) out[w.points] = w.weight;
  return out;
}

/** มุมโดยประมาณต่อช่อง (ใช้บอกเจ้าของว่าช่องใหญ่พอไหม) */
export function approxSliceDegrees(sliceCount: number): number {
  const n = clampWheelSliceCount(sliceCount);
  return Math.round((360 / n) * 10) / 10;
}
