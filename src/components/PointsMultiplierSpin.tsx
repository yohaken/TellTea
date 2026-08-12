"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SPIN_WEIGHTS,
  applyMultiplier,
  buildBoardSegments,
  boardTotalWidth,
  pickMultiplier,
  pickTargetSegment,
  type MultiplierTier,
  type SpinResult,
  type SpinWeight,
} from "@/lib/points-multiplier-spin";
import { prizeForMultiplier, spinResultFlavorLine } from "@/lib/points-spin-theme";
import { SpinBobaPointer, SpinPrizeIcon } from "@/components/PointsSpinThemeIcons";

export type PointsMultiplierSpinMode = "teaser" | "play" | "demo";

type Props = {
  mode: PointsMultiplierSpinMode;
  /** แต้มฐานที่จะนำไปคูณ */
  basePoints: number;
  weights?: readonly SpinWeight[];
  /** เล่นจริง / เดโม่ — เรียกเมื่อหยุดแล้ว */
  onComplete?: (result: SpinResult) => void;
  className?: string;
  /** ข้อความใต้กระดาน */
  hint?: string;
};

type Phase = "idle" | "spinning" | "stopping" | "done";

export function PointsMultiplierSpin({
  mode,
  basePoints,
  weights = DEFAULT_SPIN_WEIGHTS,
  onComplete,
  className = "",
  hint,
}: Props) {
  const segments = buildBoardSegments(weights, mode === "teaser" ? 6 : 5);
  const totalW = boardTotalWidth(segments);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const offsetRef = useRef(0);
  const velocityRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const targetCenterRef = useRef<number | null>(null);
  const resultRef = useRef<SpinResult | null>(null);
  /** React 19.1 ไม่มี useEffectEvent — เก็บ callback ล่าสุดใน ref */
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [offset, setOffset] = useState(0);

  function finishSpin(res: SpinResult) {
    phaseRef.current = "done";
    setPhase("done");
    setResult(res);
    onCompleteRef.current?.(res);
  }

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const el = trackRef.current;
      if (!el) return;

      const viewport = el.parentElement?.clientWidth || 280;
      const unitPx = viewport / Math.max(totalW * 0.42, 1);

      if (phaseRef.current === "idle" && mode === "teaser") {
        velocityRef.current = 38;
      }

      if (
        phaseRef.current === "idle" ||
        phaseRef.current === "spinning" ||
        phaseRef.current === "stopping"
      ) {
        let v = velocityRef.current;
        let o = offsetRef.current;

        if (phaseRef.current === "spinning") {
          v = Math.max(v, 120);
        }

        if (phaseRef.current === "stopping" && targetCenterRef.current != null) {
          const pointer = viewport / 2;
          const loopW = totalW * unitPx;
          const desired = targetCenterRef.current * unitPx - pointer;
          let target = desired;
          while (target < o) target += loopW;
          const dist = target - o;
          if (dist < 40 && v < 28) {
            o = target;
            v = 0;
            offsetRef.current = o;
            velocityRef.current = 0;
            setOffset(o);
            el.style.transform = `translate3d(${-o}px,0,0)`;
            const res = resultRef.current;
            if (res) finishSpin(res);
            return;
          }
          const brake = Math.max(18, dist * 0.9);
          v = Math.min(v, brake);
          v = Math.max(12, v * (1 - dt * 1.35));
        }

        o += v * dt * unitPx * 0.55;
        const loopW = totalW * unitPx;
        if (loopW > 0 && o > loopW) o %= loopW;

        offsetRef.current = o;
        velocityRef.current = v;
        setOffset(o);
        el.style.transform = `translate3d(${-o}px,0,0)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode, totalW]);

  function startSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current === "spinning" || phaseRef.current === "stopping") return;
    const mult = pickMultiplier(weights);
    const res = applyMultiplier(basePoints, mult);
    const target = pickTargetSegment(segments, mult);
    resultRef.current = res;
    targetCenterRef.current = target.center;
    setResult(null);
    phaseRef.current = "spinning";
    setPhase("spinning");
    velocityRef.current = 160;
  }

  function stopSpin() {
    if (mode === "teaser") return;
    if (phaseRef.current !== "spinning") return;
    const mult = pickMultiplier(weights);
    const res = applyMultiplier(basePoints, mult);
    const target = pickTargetSegment(segments, mult);
    resultRef.current = res;
    targetCenterRef.current = target.center;
    phaseRef.current = "stopping";
    setPhase("stopping");
  }

  function resetPlay() {
    if (mode === "teaser") return;
    phaseRef.current = "idle";
    setPhase("idle");
    setResult(null);
    resultRef.current = null;
    targetCenterRef.current = null;
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
  const resultPrize = result ? prizeForMultiplier(result.multiplier) : null;

  return (
    <div
      className={`pts-spin pts-spin--boba ${className}`.trim()}
      data-mode={mode}
      data-phase={phase}
    >
      <div className="pts-spin-deco" aria-hidden>
        <span className="pts-spin-pearl pts-spin-pearl--a" />
        <span className="pts-spin-pearl pts-spin-pearl--b" />
        <span className="pts-spin-pearl pts-spin-pearl--c" />
      </div>

      <div className="pts-spin-head">
        <div className="pts-spin-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-telltea.svg"
            alt="Tell Tea"
            className="pts-spin-logo"
            width={120}
            height={60}
          />
        </div>
        <p className="pts-spin-title">หมุนลุ้นคูณแต้ม</p>
        <p className="pts-spin-sub">
          {mode === "teaser"
            ? "ชา · ขนม · กดหยุดลุ้น ×1–×5"
            : `แต้มฐาน ${Math.max(0, Math.trunc(basePoints))} · กดหยุดเมื่อพร้อม`}
        </p>
      </div>

      <div className="pts-spin-stage" aria-hidden={mode === "teaser"}>
        <div className="pts-spin-pointer-wrap">
          <SpinBobaPointer />
        </div>
        <div className="pts-spin-window">
          <div
            ref={trackRef}
            className="pts-spin-track"
            style={{ transform: `translate3d(${-offset}px,0,0)` }}
          >
            {segments.map((seg) => {
              const prize = prizeForMultiplier(seg.multiplier as MultiplierTier);
              return (
                <div
                  key={seg.id}
                  className={`pts-spin-seg pts-spin-seg--${prize.tone}`}
                  style={{ flex: `${seg.width} 0 0` }}
                >
                  <SpinPrizeIcon multiplier={seg.multiplier} />
                  <span className="pts-spin-seg-mult">×{seg.multiplier}</span>
                  <span className="pts-spin-seg-name">{prize.shortLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ul className="pts-spin-legend" aria-label="เมนูบนกระดาน">
        {([1, 2, 3, 4, 5] as MultiplierTier[]).map((m) => {
          const p = prizeForMultiplier(m);
          return (
            <li key={m} className={`pts-spin-legend-item pts-spin-legend-item--${p.tone}`}>
              <SpinPrizeIcon multiplier={m} />
              <span>
                ×{m} {p.shortLabel}
              </span>
            </li>
          );
        })}
      </ul>

      {mode !== "teaser" ? (
        <div className="pts-spin-actions">
          {canStart ? (
            <button type="button" className="primary-btn pts-spin-btn" onClick={startSpin}>
              {phase === "done" ? "หมุนอีกแก้ว" : "เริ่มหมุน"}
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
            <p className="pts-spin-waiting muted">ไข่มุกกำลังหยุด...</p>
          ) : null}
          {phase === "done" && mode === "demo" ? (
            <button type="button" className="ghost-btn pts-spin-btn" onClick={resetPlay}>
              รีเซ็ต
            </button>
          ) : null}
        </div>
      ) : null}

      {showResult && result && resultPrize ? (
        <div className="pts-spin-result" role="status">
          <div className="pts-spin-result-prize">
            <SpinPrizeIcon multiplier={result.multiplier} />
          </div>
          <p className="pts-spin-result-mult">×{result.multiplier}</p>
          <p className="pts-spin-result-flavor">{spinResultFlavorLine(result.multiplier)}</p>
          <p>
            {result.basePoints} → <strong>{result.finalPoints}</strong> แต้ม
            {result.bonusPoints > 0 ? (
              <span className="pts-spin-bonus"> (+{result.bonusPoints})</span>
            ) : (
              <span className="muted"> · เท่าเดิมก็หวานดี</span>
            )}
          </p>
        </div>
      ) : null}

      {hint ? <p className="pts-spin-hint muted">{hint}</p> : null}
      {mode === "teaser" && !hint ? (
        <p className="pts-spin-hint muted">ชิ้นแคบ = ยาก · ชิโอปัง ×5 หายากสุด</p>
      ) : null}
    </div>
  );
}
