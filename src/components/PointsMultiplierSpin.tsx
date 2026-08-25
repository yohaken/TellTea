"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SPIN_WEIGHTS,
  DEFAULT_WHEEL_SLICE_COUNT,
  WHEEL_SPIN_SPEED,
  WHEEL_STOP_DECEL,
  WHEEL_STOP_EPS,
  awardSpinPoints,
  buildWheelSlices,
  clampWheelSliceCount,
  sliceAtPointer,
  type SliceSizingMode,
  type SpinResult,
  type SpinWeight,
  type LegacySpinWeight,
  type WheelSlice,
} from "@/lib/points-multiplier-spin";
import {
  POINTS_ONLY_NOTE,
  prizeForPoints,
  spinResultFlavorLine,
} from "@/lib/points-spin-theme";
import { PointsGameBrandLogo } from "@/components/PointsGameBrandLogo";

export type PointsMultiplierSpinMode = "teaser" | "play" | "demo";

type Props = {
  mode: PointsMultiplierSpinMode;
  /** แต้มฐานก่อนเล่น — แสดงบริบทอย่างเดียว ไม่นำไปคูณ */
  basePoints?: number;
  weights?: readonly (SpinWeight | LegacySpinWeight)[];
  /** จำนวนช่องบนวง (8–24) — น้อย = ช่องใหญ่ กะจังหวะได้ */
  sliceCount?: number;
  /** ความเร็วหมุนก่อนกดหยุด (deg/s) */
  spinSpeed?: number;
  /** ความหน่วงตอนกดหยุด (deg/s²) */
  stopDecel?: number;
  /** equal = ช่องเท่ากัน · byWeight = กว้างตาม % */
  sliceSizing?: SliceSizingMode;
  /** >0 = สุ่มตำแหน่งจาก seed (ล็อกในรอบ) */
  layoutSeed?: number;
  onComplete?: (result: SpinResult) => void;
  className?: string;
  hint?: string;
};

type Phase = "idle" | "spinning" | "coasting" | "done";

const TONE_FILL: Record<string, string> = {
  miss: "#8A9AA8",
  thai: "#E8913A",
  boba: "#0077B6",
  cookie: "#D4A574",
  brownie: "#5C3A2E",
  cheese: "#F0D48A",
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const [x1, y1] = polar(cx, cy, r, start);
  const [x2, y2] = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/**
 * วงล้อหมุนลุ้นแต้มได้เพิ่ม 0–5 (+0 = ไม่ได้เพิ่มจากเกม)
 * กดหยุด = หน่วงตามฟิสิกส์ แล้วอ่านชิ้นใต้เข็ม — ช่องใหญ่พอให้กะจังหวะได้
 */
export function PointsMultiplierSpin({
  mode,
  basePoints = 0,
  weights = DEFAULT_SPIN_WEIGHTS,
  sliceCount = DEFAULT_WHEEL_SLICE_COUNT,
  spinSpeed = WHEEL_SPIN_SPEED,
  stopDecel = WHEEL_STOP_DECEL,
  sliceSizing = "byWeight",
  layoutSeed = 0,
  onComplete,
  className = "",
  hint,
}: Props) {
  const slicesN = clampWheelSliceCount(sliceCount);
  const speed = Math.max(160, Math.min(640, spinSpeed));
  const decelBase = Math.max(180, Math.min(900, stopDecel));
  const sizing: SliceSizingMode =
    sliceSizing === "equal" ? "equal" : "byWeight";
  const seed = layoutSeed > 0 ? Math.floor(layoutSeed) : 0;

  const slices = useMemo(
    () =>
      buildWheelSlices(weights, slicesN, {
        sliceSizing: sizing,
        layoutSeed: seed,
      }),
    [weights, slicesN, sizing, seed],
  );
  const legendTiers = useMemo(() => {
    const seen = new Set<number>();
    const out: WheelSlice[] = [];
    for (const s of slices) {
      if (seen.has(s.points)) continue;
      seen.add(s.points);
      out.push(s);
    }
    return out.sort((a, b) => a.points - b.points);
  }, [slices]);

  const rafRef = useRef(0);
  const rotationRef = useRef(0);
  const velocityRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const baseRef = useRef(basePoints);
  baseRef.current = basePoints;
  const slicesRef = useRef(slices);
  slicesRef.current = slices;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const decelRef = useRef(decelBase);
  decelRef.current = decelBase;

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [rotation, setRotation] = useState(0);

  function finishAtCurrent() {
    if (phaseRef.current === "done") return;
    const slice = sliceAtPointer(rotationRef.current, slicesRef.current);
    const res = awardSpinPoints(slice.points, baseRef.current);
    phaseRef.current = "done";
    velocityRef.current = 0;
    setPhase("done");
    setResult(res);
    onCompleteRef.current?.(res);
  }

  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let v = velocityRef.current;
      let r = rotationRef.current;
      const ph = phaseRef.current;

      if (ph === "idle" && mode === "teaser") {
        // ทีเซอร์ช้า — มองเห็นช่องชัด
        v = Math.min(42, speedRef.current * 0.14);
      } else if (ph === "spinning") {
        const target = speedRef.current;
        v += (target - v) * Math.min(1, dt * 6);
      } else if (ph === "coasting") {
        const decel = Math.max(decelRef.current, Math.abs(v) * 0.7);
        if (v > 0) {
          v = Math.max(0, v - decel * dt);
        } else if (v < 0) {
          v = Math.min(0, v + decel * dt);
        }
        if (Math.abs(v) < WHEEL_STOP_EPS) {
          v = 0;
          rotationRef.current = r;
          velocityRef.current = 0;
          setRotation(r);
          finishAtCurrent();
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
      }

      if (ph === "idle" || ph === "spinning" || ph === "coasting") {
        r += v * dt;
        rotationRef.current = r;
        velocityRef.current = v;
        setRotation(r);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function startSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current === "spinning" || phaseRef.current === "coasting") return;
    setResult(null);
    phaseRef.current = "spinning";
    setPhase("spinning");
    velocityRef.current = speedRef.current * 0.85;
  }

  function stopSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current !== "spinning") return;
    phaseRef.current = "coasting";
    setPhase("coasting");
  }

  function resetPlay() {
    if (mode === "teaser") return;
    phaseRef.current = "idle";
    setPhase("idle");
    setResult(null);
    velocityRef.current = 0;
  }

  useEffect(() => {
    if (mode !== "play") return;
    if (phase !== "idle" || result) return;
    const t = window.setTimeout(() => startSpin(), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const canStop = phase === "spinning";
  const canStart = mode !== "teaser" && (phase === "idle" || phase === "done");
  const showResult = phase === "done" && result;
  const cx = 100;
  const cy = 100;
  const radius = 92;
  const degEach = Math.round((360 / slices.length) * 10) / 10;

  return (
    <div
      className={`pts-spin pts-spin--wheel ${className}`.trim()}
      data-mode={mode}
      data-phase={phase}
      data-slices={slices.length}
    >
      <div className="pts-spin-head">
        <p className="pts-spin-title">หมุนวงล้อลุ้นแต้ม</p>
        <p className="pts-spin-sub">
          {mode === "teaser"
            ? `ลุ้นแต้มได้เพิ่ม 0–5 · ${slices.length} ช่อง (~${degEach}°) · ชิ้นคละรอบวง`
            : `กดหยุดตอนช่องที่อยากได้ · ${slices.length} ช่อง (~${degEach}°) · วงหน่วงเอง`}
        </p>
        <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
      </div>

      <div className="pts-wheel-stage" aria-hidden={mode === "teaser"}>
        <div className="pts-wheel-pointer" aria-hidden />
        <div
          className="pts-wheel-disc"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <svg
            viewBox="0 0 200 200"
            className="pts-wheel-svg"
            role="img"
            aria-label="วงล้อลุ้นแต้ม"
          >
            {slices.map((slice) => {
              const tone = prizeForPoints(slice.points).tone;
              const [tx, ty] = polar(cx, cy, radius * 0.64, slice.midDeg);
              return (
                <g key={slice.id}>
                  <path
                    d={slicePath(cx, cy, radius, slice.startDeg, slice.endDeg)}
                    fill={TONE_FILL[tone] || "#0077B6"}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth="1.1"
                  />
                  <text
                    x={tx}
                    y={ty}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="pts-wheel-label"
                    transform={`rotate(${slice.midDeg}, ${tx}, ${ty})`}
                  >
                    {prizeForPoints(slice.points).shortLabel}
                  </text>
                </g>
              );
            })}
            <circle
              cx={cx}
              cy={cy}
              r="28"
              fill="#FFF6E8"
              stroke="#003B5C"
              strokeWidth="2"
            />
          </svg>
          <div className="pts-wheel-hub">
            <PointsGameBrandLogo className="pts-wheel-hub-logo" />
          </div>
        </div>
      </div>

      <ul className="pts-spin-legend" aria-label="แต้มได้เพิ่มบนวงล้อ">
        {legendTiers.map((s) => (
          <li
            key={s.points}
            className={`pts-spin-legend-item pts-spin-legend-item--${prizeForPoints(s.points).tone}`}
          >
            <span>
              {s.points === 0 ? "+0 ไม่เพิ่ม" : `+${s.points} แต้มเพิ่ม`}
            </span>
          </li>
        ))}
      </ul>

      {mode !== "teaser" ? (
        <div className="pts-spin-actions">
          {canStart ? (
            <button
              type="button"
              className="primary-btn pts-spin-btn"
              onClick={startSpin}
            >
              {phase === "done" ? "หมุนอีกครั้ง" : "เริ่มหมุน"}
            </button>
          ) : null}
          {canStop ? (
            <button
              type="button"
              className="primary-btn pts-spin-btn pts-spin-btn--stop"
              onClick={stopSpin}
            >
              หยุด!
            </button>
          ) : null}
          {phase === "coasting" ? (
            <p className="pts-spin-waiting muted">กำลังหน่วง… กะช่องใต้เข็ม</p>
          ) : null}
          {phase === "done" && mode === "demo" ? (
            <button
              type="button"
              className="ghost-btn pts-spin-btn"
              onClick={resetPlay}
            >
              รีเซ็ต
            </button>
          ) : null}
        </div>
      ) : null}

      {showResult && result ? (
        <div className="pts-spin-result" role="status">
          <p className="pts-spin-result-mult">
            {result.points === 0 ? "+0" : `+${result.points}`}
          </p>
          <p className="pts-spin-result-flavor">
            {spinResultFlavorLine(result.points)}
          </p>
          <p>
            {result.points === 0 ? (
              <>
                รอบนี้<strong>ไม่ได้แต้มเพิ่มจากเกม</strong>
                <span className="muted"> · แต้มเดิมยังอยู่ครบ</span>
              </>
            ) : (
              <>
                ได้เพิ่ม <strong>{result.finalPoints}</strong> แต้ม
              </>
            )}
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
        </div>
      ) : null}

      {hint ? <p className="pts-spin-hint muted">{hint}</p> : null}
      {mode === "teaser" && !hint ? (
        <p className="pts-spin-hint muted">
          ช่องใหญ่พอให้กะ · กดหยุดใช้จังหวะตัวเอง
        </p>
      ) : null}
    </div>
  );
}
