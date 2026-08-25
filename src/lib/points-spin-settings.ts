/**
 * ค่าตั้งเกมหมุนวงล้อ — เจ้าของปรับได้ที่ /members/spin-demo/
 * เก็บที่ meta/pointsSpinSettings · หน้าสมาชิกลูกค้า subscribe แล้วมีผลทันทีหลังบันทึก
 *
 * ค่าเล่นจริง: สุ่มต่อรอบภายในช่วง (จำนวนช่อง / ความเร็ว / ความหน่วง)
 * + สลับตำแหน่ง + ขนาดช่องตาม % ได้
 */
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  DEFAULT_SPIN_WEIGHTS,
  POINT_TIERS,
  WHEEL_SLICE_COUNT_MAX,
  WHEEL_SLICE_COUNT_MIN,
  clampWheelSliceCount,
  normalizeWeights,
  type PointTier,
  type SliceSizingMode,
  type SpinWeight,
} from "@/lib/points-multiplier-spin";
import type { PointsGameId } from "@/lib/points-games";

export const POINTS_SPIN_SETTINGS_DOC = "pointsSpinSettings";

export {
  WHEEL_SLICE_COUNT_MIN as SLICE_COUNT_MIN,
  WHEEL_SLICE_COUNT_MAX as SLICE_COUNT_MAX,
};

/** ค่าเริ่มช่วงสุ่ม — กันจับทาง */
export const DEFAULT_SLICE_COUNT_MIN = 16;
export const DEFAULT_SLICE_COUNT_MAX = 22;
/** mid ของช่วง — ใช้พรีวิว / เอกสารเก่า */
export const DEFAULT_SLICE_COUNT = 19;

export const DEFAULT_SPIN_SPEED_MIN = 160;
export const DEFAULT_SPIN_SPEED_MAX = 200;
export const DEFAULT_STOP_DECEL_MIN = 180;
export const DEFAULT_STOP_DECEL_MAX = 800;

/** เปิด/ปิดรายเกมบนลิงก์ลูกค้า — ค่าเริ่มปิดจนกว่าเจ้าของกดเปิด */
export type PointsGamesEnabled = Record<PointsGameId, boolean>;

export type PointsSpinSettings = {
  /**
   * จำนวนช่องที่ resolve แล้วในรอบเล่น (หรือ mid สำหรับพรีวิว)
   * ช่วงสุ่มอยู่ที่ sliceCountMin/Max
   */
  sliceCount: number;
  sliceCountMin: number;
  sliceCountMax: number;
  /** สัดส่วนมุมรวมของแต้ม 0–5 (0 = ไม่ได้แต้มเพิ่ม) — ไม่สุ่ม */
  weights: SpinWeight[];
  spinSpeed: number;
  spinSpeedMin: number;
  spinSpeedMax: number;
  stopDecel: number;
  stopDecelMin: number;
  stopDecelMax: number;
  /** สุ่มสลับตำแหน่งชิ้นต่อรอบ */
  shuffleLayout: boolean;
  /** equal = ช่องเท่ากัน · byWeight = กว้างตาม % */
  sliceSizing: SliceSizingMode;
  /**
   * seed ตำแหน่งในรอบเล่นที่ resolve แล้ว (0 = ใช้ layout เดิม deterministic)
   * ไม่บันทึกลง Firestore — ใส่ตอน resolvePlaySettings เท่านั้น
   */
  layoutSeed: number;
  /** เปิดเกมบน /claim · /join รายเกม */
  gamesEnabled: PointsGamesEnabled;
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_GAMES_ENABLED: PointsGamesEnabled = {
  spin: false,
};

export const DEFAULT_POINTS_SPIN_SETTINGS: PointsSpinSettings = {
  sliceCount: DEFAULT_SLICE_COUNT,
  sliceCountMin: DEFAULT_SLICE_COUNT_MIN,
  sliceCountMax: DEFAULT_SLICE_COUNT_MAX,
  weights: DEFAULT_SPIN_WEIGHTS.map((w) => ({ ...w })),
  spinSpeed: 180,
  spinSpeedMin: DEFAULT_SPIN_SPEED_MIN,
  spinSpeedMax: DEFAULT_SPIN_SPEED_MAX,
  stopDecel: 490,
  stopDecelMin: DEFAULT_STOP_DECEL_MIN,
  stopDecelMax: DEFAULT_STOP_DECEL_MAX,
  shuffleLayout: true,
  sliceSizing: "byWeight",
  layoutSeed: 0,
  gamesEnabled: { ...DEFAULT_GAMES_ENABLED },
  updatedAt: 0,
  updatedBy: "",
};

export function clampSpinSpeed(n: unknown): number {
  const v = Number(n);
  if (!(v > 0) || !Number.isFinite(v)) {
    return DEFAULT_POINTS_SPIN_SETTINGS.spinSpeed;
  }
  return Math.max(160, Math.min(640, Math.round(v)));
}

export function clampStopDecel(n: unknown): number {
  const v = Number(n);
  if (!(v > 0) || !Number.isFinite(v)) {
    return DEFAULT_POINTS_SPIN_SETTINGS.stopDecel;
  }
  return Math.max(180, Math.min(900, Math.round(v)));
}

function clampRangePair(
  minRaw: unknown,
  maxRaw: unknown,
  clampOne: (n: unknown) => number,
  fallbackMin: number,
  fallbackMax: number,
): { min: number; max: number } {
  const hasMin = minRaw != null && minRaw !== "";
  const hasMax = maxRaw != null && maxRaw !== "";
  let min = hasMin ? clampOne(minRaw) : fallbackMin;
  let max = hasMax ? clampOne(maxRaw) : fallbackMax;
  if (!hasMin && !hasMax) {
    min = fallbackMin;
    max = fallbackMax;
  }
  if (min > max) {
    const t = min;
    min = max;
    max = t;
  }
  return { min, max };
}

function midOf(min: number, max: number): number {
  return Math.round((min + max) / 2);
}

function randIntInclusive(min: number, max: number, rng: () => number): number {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.floor(rng() * (b - a + 1));
}

export function normalizeGamesEnabled(
  raw: unknown,
): PointsGamesEnabled {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    spin: src.spin === true,
  };
}

export function normalizeSliceSizing(raw: unknown): SliceSizingMode {
  return raw === "equal" ? "equal" : "byWeight";
}

export function isPointsGameEnabled(
  settings: PointsSpinSettings | null | undefined,
  gameId: PointsGameId = "spin",
): boolean {
  if (!settings) return false;
  return settings.gamesEnabled?.[gameId] === true;
}

export function normalizeSpinSettings(
  raw: Partial<PointsSpinSettings> | Record<string, unknown> | null | undefined,
): PointsSpinSettings {
  const data = (raw || {}) as Partial<PointsSpinSettings> & {
    weights?: unknown;
    gamesEnabled?: unknown;
    sliceSizing?: unknown;
    shuffleLayout?: unknown;
    layoutSeed?: unknown;
  };
  let weightsIn: SpinWeight[] = DEFAULT_SPIN_WEIGHTS.map((w) => ({ ...w }));
  if (Array.isArray(data.weights)) {
    weightsIn = data.weights as SpinWeight[];
  }

  const slicePair = clampRangePair(
    data.sliceCountMin,
    data.sliceCountMax,
    clampWheelSliceCount,
    DEFAULT_SLICE_COUNT_MIN,
    DEFAULT_SLICE_COUNT_MAX,
  );
  // เอกสารเก่ามีแค่ sliceCount เดี่ยว → ใช้เป็น mid ของช่วงเริ่ม (ยังสุ่มในช่วง default)
  if (
    data.sliceCountMin == null &&
    data.sliceCountMax == null &&
    data.sliceCount != null
  ) {
    // คงช่วง default 16–22 เพื่อเปิดกันจับทาง — ไม่ล็อก min=max จากค่าเก่า
  }

  const speedPair = clampRangePair(
    data.spinSpeedMin,
    data.spinSpeedMax,
    clampSpinSpeed,
    DEFAULT_SPIN_SPEED_MIN,
    DEFAULT_SPIN_SPEED_MAX,
  );
  const decelPair = clampRangePair(
    data.stopDecelMin,
    data.stopDecelMax,
    clampStopDecel,
    DEFAULT_STOP_DECEL_MIN,
    DEFAULT_STOP_DECEL_MAX,
  );

  const sliceCount = clampWheelSliceCount(
    data.sliceCount ?? midOf(slicePair.min, slicePair.max),
  );
  const spinSpeed = clampSpinSpeed(
    data.spinSpeed ?? midOf(speedPair.min, speedPair.max),
  );
  const stopDecel = clampStopDecel(
    data.stopDecel ?? midOf(decelPair.min, decelPair.max),
  );

  const layoutSeedRaw = Number(data.layoutSeed);
  const layoutSeed =
    Number.isFinite(layoutSeedRaw) && layoutSeedRaw > 0
      ? Math.floor(layoutSeedRaw)
      : 0;

  return {
    sliceCount,
    sliceCountMin: slicePair.min,
    sliceCountMax: slicePair.max,
    weights: normalizeWeights(weightsIn),
    spinSpeed,
    spinSpeedMin: speedPair.min,
    spinSpeedMax: speedPair.max,
    stopDecel,
    stopDecelMin: decelPair.min,
    stopDecelMax: decelPair.max,
    shuffleLayout: data.shuffleLayout !== false,
    sliceSizing: normalizeSliceSizing(data.sliceSizing),
    layoutSeed,
    gamesEnabled: normalizeGamesEnabled(data.gamesEnabled),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
  };
}

/**
 * สุ่มค่าเล่นหนึ่งรอบจากช่วงที่ตั้งไว้ แล้วล็อก (รวม layoutSeed ถ้าเปิดสลับตำแหน่ง)
 */
export function resolvePlaySettings(
  base: PointsSpinSettings,
  rng: () => number = Math.random,
): PointsSpinSettings {
  const sliceCount = randIntInclusive(
    base.sliceCountMin,
    base.sliceCountMax,
    rng,
  );
  const spinSpeed = randIntInclusive(base.spinSpeedMin, base.spinSpeedMax, rng);
  const stopDecel = randIntInclusive(
    base.stopDecelMin,
    base.stopDecelMax,
    rng,
  );
  const layoutSeed = base.shuffleLayout
    ? 1 + Math.floor(rng() * 1_000_000_000)
    : 0;
  return {
    ...base,
    sliceCount,
    spinSpeed,
    stopDecel,
    layoutSeed,
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

/** Realtime — หน้าสมาชิกใช้หลังเจ้าของกดบันทึกจะมีผลทันที */
export function subscribePointsSpinSettings(
  onData: (settings: PointsSpinSettings) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    settingsRef(),
    (snap) => {
      if (!snap.exists()) {
        onData({ ...DEFAULT_POINTS_SPIN_SETTINGS });
        return;
      }
      onData(normalizeSpinSettings(snap.data() as Record<string, unknown>));
    },
    (err) => {
      onError?.(err);
      onData({ ...DEFAULT_POINTS_SPIN_SETTINGS });
    },
  );
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
    gamesEnabled: patch.gamesEnabled
      ? { ...current.gamesEnabled, ...patch.gamesEnabled }
      : current.gamesEnabled,
    layoutSeed: 0,
    updatedAt: Date.now(),
    updatedBy: actorId || current.updatedBy || "",
  });
  await setDoc(
    settingsRef(),
    {
      sliceCount: next.sliceCount,
      sliceCountMin: next.sliceCountMin,
      sliceCountMax: next.sliceCountMax,
      weights: next.weights.map((w) => ({ points: w.points, weight: w.weight })),
      spinSpeed: next.spinSpeed,
      spinSpeedMin: next.spinSpeedMin,
      spinSpeedMax: next.spinSpeedMax,
      stopDecel: next.stopDecel,
      stopDecelMin: next.stopDecelMin,
      stopDecelMax: next.stopDecelMax,
      shuffleLayout: next.shuffleLayout === true,
      sliceSizing: next.sliceSizing,
      gamesEnabled: { spin: next.gamesEnabled.spin === true },
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
    },
    { merge: true },
  );
  return next;
}

export function weightMap(settings: PointsSpinSettings): Record<PointTier, number> {
  const out: Record<PointTier, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const t of POINT_TIERS) out[t] = 0;
  for (const w of settings.weights) out[w.points] = w.weight;
  return out;
}

/** มุมโดยประมาณต่อช่องเมื่อโหมด equal */
export function approxSliceDegrees(sliceCount: number): number {
  const n = clampWheelSliceCount(sliceCount);
  return Math.round((360 / n) * 10) / 10;
}

export function wheelBuildOptionsFromSettings(settings: PointsSpinSettings): {
  sliceSizing: SliceSizingMode;
  layoutSeed: number;
} {
  return {
    sliceSizing: settings.sliceSizing,
    layoutSeed: settings.layoutSeed > 0 ? settings.layoutSeed : 0,
  };
}
