"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SPIN_WEIGHTS,
  WHEEL_SPIN_SPEED,
  WHEEL_STOP_DECEL,
  WHEEL_STOP_EPS,
  awardSpinPoints,
  buildWheelSlices,
  sliceAtPointer,
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
  onComplete?: (result: SpinResult) => void;
  className?: string;
  hint?: string;
};

type Phase = "idle" | "spinning" | "coasting" | "done";

const TONE_FILL: Record<string, string> = {
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
 * วงล้อหมุนได้แต้ม 1–5
 * กดหยุด = ปล่อยให้หน่วงตามฟิสิกส์ แล้วอ่านชิ้นใต้เข็ม (ไม่สุ่มผลล่วงหน้า)
 */
export function PointsMultiplierSpin({
  mode,
  basePoints = 0,
  weights = DEFAULT_SPIN_WEIGHTS,
  onComplete,
  className = "",
  hint,
}: Props) {
  const slices = useMemo(() => buildWheelSlices(weights, 40), [weights]);
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
        v = 48;
      } else if (ph === "spinning") {
        // รักษาความเร็วหมุนจนกว่าจะกดหยุด
        const target = WHEEL_SPIN_SPEED;
        v += (target - v) * Math.min(1, dt * 6);
      } else if (ph === "coasting") {
        // หน่วงมุมคงที่ (ฟิสิกส์ง่าย) — ผลอยู่ที่มุมสุดท้ายใต้เข็ม
        const decel = Math.max(WHEEL_STOP_DECEL, Math.abs(v) * 0.85);
        if (v > 0) {
          v = Math.max(0, v - decel * dt);
        } else if (v < 0) {
          v = Math.min(0, v + decel * dt);
        }
        if (Math.abs(v) < WHEEL_STOP_EPS) {
          v = 0;
          r += v * dt;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loop binds mode only
  }, [mode]);

  function startSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current === "spinning" || phaseRef.current === "coasting") return;
    setResult(null);
    phaseRef.current = "spinning";
    setPhase("spinning");
    velocityRef.current = WHEEL_SPIN_SPEED * 0.85;
  }

  function stopSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current !== "spinning") return;
    // ปล่อยให้หน่วง — ไม่กำหนดผลล่วงหน้า
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
  const labelMinSpan = 360 / slices.length;

  return (
    <div
      className={`pts-spin pts-spin--wheel ${className}`.trim()}
      data-mode={mode}
      data-phase={phase}
    >
      <div className="pts-spin-head">
        <p className="pts-spin-title">หมุนวงล้อลุ้นแต้ม</p>
        <p className="pts-spin-sub">
          {mode === "teaser"
            ? "ลุ้นได้ 1–5 แต้ม · กดหยุดแล้วหมุนหน่วงตามแรง"
            : "กดเริ่มหมุน แล้วกดหยุด — วงล้อหน่วงเอง แต้มตามชิ้นที่ชี้"}
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
              const span = slice.endDeg - slice.startDeg;
              const [tx, ty] = polar(cx, cy, radius * 0.64, slice.midDeg);
              return (
                <g key={slice.id}>
                  <path
                    d={slicePath(cx, cy, radius, slice.startDeg, slice.endDeg)}
                    fill={TONE_FILL[tone] || "#0077B6"}
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth="0.8"
                  />
                  {span >= Math.min(14, labelMinSpan * 0.85) ? (
                    <text
                      x={tx}
                      y={ty}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="pts-wheel-label"
                      transform={`rotate(${slice.midDeg}, ${tx}, ${ty})`}
                    >
                      {slice.points}
                    </text>
                  ) : null}
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

      <ul className="pts-spin-legend" aria-label="แต้มบนวงล้อ">
        {legendTiers.map((s) => (
          <li
            key={s.points}
            className={`pts-spin-legend-item pts-spin-legend-item--${prizeForPoints(s.points).tone}`}
          >
            <span>{s.points} แต้ม</span>
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
            <p className="pts-spin-waiting muted">กำลังหน่วง…</p>
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
          <p className="pts-spin-result-mult">+{result.points}</p>
          <p className="pts-spin-result-flavor">
            {spinResultFlavorLine(result.points)}
          </p>
          <p>
            ได้ <strong>{result.finalPoints}</strong> แต้ม
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
        </div>
      ) : null}

      {hint ? <p className="pts-spin-hint muted">{hint}</p> : null}
      {mode === "teaser" && !hint ? (
        <p className="pts-spin-hint muted">ชิ้นกระจายรอบวง · 5 แต้มหายากสุด</p>
      ) : null}
    </div>
  );
}
