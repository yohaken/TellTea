"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SPIN_WEIGHTS,
  applyMultiplier,
  buildWheelSlices,
  pickMultiplier,
  wheelTargetRotation,
  type MultiplierTier,
  type SpinResult,
  type SpinWeight,
  type WheelSlice,
} from "@/lib/points-multiplier-spin";
import { POINTS_ONLY_NOTE, prizeForMultiplier, spinResultFlavorLine } from "@/lib/points-spin-theme";
import { PointsGameBrandLogo } from "@/components/PointsGameBrandLogo";

export type PointsMultiplierSpinMode = "teaser" | "play" | "demo";

type Props = {
  mode: PointsMultiplierSpinMode;
  basePoints: number;
  weights?: readonly SpinWeight[];
  onComplete?: (result: SpinResult) => void;
  className?: string;
  hint?: string;
};

type Phase = "idle" | "spinning" | "stopping" | "done";

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

export function PointsMultiplierSpin({
  mode,
  basePoints,
  weights = DEFAULT_SPIN_WEIGHTS,
  onComplete,
  className = "",
  hint,
}: Props) {
  const slices = useMemo(() => buildWheelSlices(weights), [weights]);
  const rafRef = useRef(0);
  const rotationRef = useRef(0);
  const velocityRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const targetRotRef = useRef<number | null>(null);
  const resultRef = useRef<SpinResult | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [rotation, setRotation] = useState(0);

  function finishSpin(res: SpinResult) {
    phaseRef.current = "done";
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

      if (phaseRef.current === "idle" && mode === "teaser") {
        v = 55;
      }
      if (phaseRef.current === "spinning") {
        v = Math.max(v, 420);
      }
      if (phaseRef.current === "stopping" && targetRotRef.current != null) {
        const target = targetRotRef.current;
        const dist = target - r;
        if (dist < 2 && v < 40) {
          r = target;
          v = 0;
          rotationRef.current = r;
          velocityRef.current = 0;
          setRotation(r);
          const res = resultRef.current;
          if (res) finishSpin(res);
          return;
        }
        v = Math.min(v, Math.max(28, dist * 1.1));
        v = Math.max(18, v * (1 - dt * 1.25));
      }

      if (
        phaseRef.current === "idle" ||
        phaseRef.current === "spinning" ||
        phaseRef.current === "stopping"
      ) {
        r += v * dt;
        rotationRef.current = r;
        velocityRef.current = v;
        setRotation(r);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode]);

  function beginToward(mult: MultiplierTier) {
    const slice = slices.find((s) => s.multiplier === mult) || slices[0]!;
    const res = applyMultiplier(basePoints, mult);
    resultRef.current = res;
    targetRotRef.current = wheelTargetRotation(slice.midDeg, 5);
    // ต่อจากมุมปัจจุบัน — อย่าถอยหลัง
    const cur = rotationRef.current;
    let target = targetRotRef.current;
    while (target < cur + 360) target += 360;
    targetRotRef.current = target;
    setResult(null);
  }

  function startSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current === "spinning" || phaseRef.current === "stopping") return;
    const mult = pickMultiplier(weights);
    beginToward(mult);
    phaseRef.current = "spinning";
    setPhase("spinning");
    velocityRef.current = 480;
  }

  function stopSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current !== "spinning") return;
    const mult = pickMultiplier(weights);
    beginToward(mult);
    phaseRef.current = "stopping";
    setPhase("stopping");
  }

  function resetPlay() {
    if (mode === "teaser") return;
    phaseRef.current = "idle";
    setPhase("idle");
    setResult(null);
    resultRef.current = null;
    targetRotRef.current = null;
    velocityRef.current = 0;
  }

  useEffect(() => {
    if (mode !== "play") return;
    if (phase !== "idle" || result) return;
    const t = window.setTimeout(() => startSpin(), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/play only
  }, [mode]);

  const canStop = phase === "spinning";
  const canStart = mode !== "teaser" && (phase === "idle" || phase === "done");
  const showResult = phase === "done" && result;
  const cx = 100;
  const cy = 100;
  const radius = 92;

  return (
    <div
      className={`pts-spin pts-spin--wheel ${className}`.trim()}
      data-mode={mode}
      data-phase={phase}
    >
      <div className="pts-spin-head">
        <p className="pts-spin-title">หมุนวงล้อคูณแต้ม</p>
        <p className="pts-spin-sub">
          {mode === "teaser"
            ? "ลุ้นคูณแต้ม ×1–×5 · ไม่ใช่ของแถม"
            : `แต้มฐาน ${Math.max(0, Math.trunc(basePoints))} · กดหยุดเมื่อพร้อม`}
        </p>
        <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
      </div>

      <div className="pts-wheel-stage" aria-hidden={mode === "teaser"}>
        <div className="pts-wheel-pointer" aria-hidden />
        <div
          className="pts-wheel-disc"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <svg viewBox="0 0 200 200" className="pts-wheel-svg" role="img" aria-label="วงล้อคูณแต้ม">
            {slices.map((slice: WheelSlice) => {
              const tone = prizeForMultiplier(slice.multiplier).tone;
              const [tx, ty] = polar(cx, cy, radius * 0.62, slice.midDeg);
              return (
                <g key={slice.multiplier}>
                  <path
                    d={slicePath(cx, cy, radius, slice.startDeg, slice.endDeg)}
                    fill={TONE_FILL[tone] || "#0077B6"}
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth="1.2"
                  />
                  <text
                    x={tx}
                    y={ty}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="pts-wheel-label"
                    transform={`rotate(${slice.midDeg}, ${tx}, ${ty})`}
                  >
                    ×{slice.multiplier}
                  </text>
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r="28" fill="#FFF6E8" stroke="#003B5C" strokeWidth="2" />
          </svg>
          <div className="pts-wheel-hub">
            <PointsGameBrandLogo className="pts-wheel-hub-logo" />
          </div>
        </div>
      </div>

      <ul className="pts-spin-legend" aria-label="คูณแต้มบนวงล้อ">
        {slices.map((s) => (
          <li
            key={s.multiplier}
            className={`pts-spin-legend-item pts-spin-legend-item--${prizeForMultiplier(s.multiplier).tone}`}
          >
            <span>×{s.multiplier} แต้ม</span>
          </li>
        ))}
      </ul>

      {mode !== "teaser" ? (
        <div className="pts-spin-actions">
          {canStart ? (
            <button type="button" className="primary-btn pts-spin-btn" onClick={startSpin}>
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
          {phase === "stopping" ? (
            <p className="pts-spin-waiting muted">กำลังหยุด…</p>
          ) : null}
          {phase === "done" && mode === "demo" ? (
            <button type="button" className="ghost-btn pts-spin-btn" onClick={resetPlay}>
              รีเซ็ต
            </button>
          ) : null}
        </div>
      ) : null}

      {showResult && result ? (
        <div className="pts-spin-result" role="status">
          <p className="pts-spin-result-mult">×{result.multiplier}</p>
          <p className="pts-spin-result-flavor">{spinResultFlavorLine(result.multiplier)}</p>
          <p>
            {result.basePoints} → <strong>{result.finalPoints}</strong> แต้ม
            {result.bonusPoints > 0 ? (
              <span className="pts-spin-bonus"> (+{result.bonusPoints})</span>
            ) : (
              <span className="muted"> · เท่าเดิม</span>
            )}
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
        </div>
      ) : null}

      {hint ? <p className="pts-spin-hint muted">{hint}</p> : null}
      {mode === "teaser" && !hint ? (
        <p className="pts-spin-hint muted">ชิ้นแคบ = ยาก · ×5 แต้มหายากสุด</p>
      ) : null}
    </div>
  );
}
