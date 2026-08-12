"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SPIN_WEIGHTS,
  applyMultiplier,
  normalizeWeights,
  type MultiplierTier,
  type SpinResult,
  type SpinWeight,
} from "@/lib/points-multiplier-spin";
import { prizeForMultiplier, spinResultFlavorLine } from "@/lib/points-spin-theme";
import { SpinPrizeIcon } from "@/components/PointsSpinThemeIcons";

type Mode = "teaser" | "play" | "demo";

type Props = {
  mode: Mode;
  basePoints: number;
  weights?: readonly SpinWeight[];
  onComplete?: (result: SpinResult) => void;
  className?: string;
  hint?: string;
};

type Band = { multiplier: MultiplierTier; start: number; end: number };

function buildBands(weights: readonly SpinWeight[]): Band[] {
  const norm = normalizeWeights(weights);
  // จากก้นแก้วขึ้นบน: ×1 กว้าง → ×5 แคบที่ปากแก้ว
  const order: MultiplierTier[] = [1, 2, 3, 4, 5];
  const byM = new Map(norm.map((w) => [w.multiplier, w.weight]));
  const sum = order.reduce((s, m) => s + (byM.get(m) || 0), 0) || 1;
  let cursor = 0;
  return order
    .filter((m) => (byM.get(m) || 0) > 0)
    .map((m) => {
      const w = (byM.get(m) || 0) / sum;
      const start = cursor;
      const end = cursor + w;
      cursor = end;
      return { multiplier: m, start, end };
    });
}

function bandAt(bands: Band[], fill: number): MultiplierTier {
  const x = Math.min(0.999, Math.max(0, fill));
  for (const b of bands) {
    if (x >= b.start && x < b.end) return b.multiplier;
  }
  return bands[bands.length - 1]?.multiplier ?? 1;
}

export function PointsPourTeaGame({
  mode,
  basePoints,
  weights = DEFAULT_SPIN_WEIGHTS,
  onComplete,
  className = "",
  hint,
}: Props) {
  const bands = buildBands(weights);
  const [phase, setPhase] = useState<"idle" | "pouring" | "done">(
    mode === "teaser" ? "pouring" : "idle",
  );
  const [fill, setFill] = useState(0.15);
  const [result, setResult] = useState<SpinResult | null>(null);
  const fillRef = useRef(0.15);
  const dirRef = useRef(1);
  const phaseRef = useRef(phase);
  const holdingRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (mode === "teaser") {
        let f = fillRef.current + dirRef.current * dt * 0.28;
        if (f >= 0.92) {
          f = 0.92;
          dirRef.current = -1;
        } else if (f <= 0.08) {
          f = 0.08;
          dirRef.current = 1;
        }
        fillRef.current = f;
        setFill(f);
      } else if (phaseRef.current === "pouring" && holdingRef.current) {
        const f = Math.min(1, fillRef.current + dt * 0.55);
        fillRef.current = f;
        setFill(f);
        if (f >= 1) {
          // ล้น = ล็อกที่บนสุด
          lockAt(f);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loop
  }, [mode]);

  function lockAt(level: number) {
    holdingRef.current = false;
    const mult = bandAt(bands, level);
    const res = applyMultiplier(basePoints, mult);
    setResult(res);
    setPhase("done");
    phaseRef.current = "done";
    onComplete?.(res);
  }

  function start() {
    if (mode === "teaser") return;
    setResult(null);
    fillRef.current = 0;
    setFill(0);
    setPhase("pouring");
    phaseRef.current = "pouring";
  }

  function onHoldStart() {
    if (mode === "teaser" || phaseRef.current !== "pouring") return;
    holdingRef.current = true;
  }

  function onHoldEnd() {
    if (mode === "teaser" || phaseRef.current !== "pouring") return;
    if (!holdingRef.current && fillRef.current <= 0) return;
    holdingRef.current = false;
    lockAt(fillRef.current);
  }

  const liveMult = bandAt(bands, fill);
  const livePrize = prizeForMultiplier(liveMult);

  return (
    <div className={`pts-game pts-pour ${className}`.trim()} data-mode={mode} data-phase={phase}>
      <div className="pts-game-head">
        <p className="pts-spin-title">เทชาไทยให้พอดี</p>
        <p className="pts-spin-sub">
          {mode === "teaser"
            ? "กดค้างเทชา · ปล่อยตอนโซนที่อยากได้"
            : `แต้มฐาน ${Math.max(0, Math.trunc(basePoints))} · กดค้างแล้วปล่อย`}
        </p>
      </div>

      <div className="pts-pour-stage">
        <div className="pts-pour-cup" aria-hidden>
          <div className="pts-pour-bands">
            {bands.map((b) => {
              const prize = prizeForMultiplier(b.multiplier);
              return (
                <div
                  key={b.multiplier}
                  className={`pts-pour-band pts-spin-seg--${prize.tone}`}
                  style={{
                    bottom: `${b.start * 100}%`,
                    height: `${(b.end - b.start) * 100}%`,
                  }}
                >
                  <span>
                    ×{b.multiplier} {prize.shortLabel}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pts-pour-liquid" style={{ height: `${fill * 100}%` }} />
          <div className="pts-pour-rim" />
          <div className="pts-pour-straw" />
        </div>
        <p className="pts-feed-live muted">
          ระดับชา: ×{liveMult} {livePrize.shortLabel}
        </p>
      </div>

      {mode !== "teaser" ? (
        <div className="pts-spin-actions">
          {phase === "idle" || phase === "done" ? (
            <button type="button" className="primary-btn pts-spin-btn" onClick={start}>
              {phase === "done" ? "เทอีกแก้ว" : "เตรียมเท"}
            </button>
          ) : null}
          {phase === "pouring" ? (
            <button
              type="button"
              className="primary-btn pts-spin-btn pts-spin-btn--stop"
              onPointerDown={(e) => {
                e.preventDefault();
                onHoldStart();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                onHoldEnd();
              }}
              onPointerLeave={() => {
                if (holdingRef.current) onHoldEnd();
              }}
              onPointerCancel={() => {
                if (holdingRef.current) onHoldEnd();
              }}
            >
              กดค้างเพื่อเท
            </button>
          ) : null}
        </div>
      ) : null}

      {result ? (
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
            ) : null}
          </p>
        </div>
      ) : null}

      {hint ? <p className="pts-spin-hint muted">{hint}</p> : null}
      {mode === "teaser" && !hint ? (
        <p className="pts-spin-hint muted">ปากแก้วแคบ = ×5 · อย่าล้น</p>
      ) : null}
    </div>
  );
}
