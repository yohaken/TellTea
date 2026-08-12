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

type Zone = { multiplier: MultiplierTier; start: number; end: number };

function buildZones(weights: readonly SpinWeight[]): Zone[] {
  const norm = normalizeWeights(weights);
  // เรียงจากปาก (ซ้าย/0) = ยาก → ขวา = ง่าย : ×5 ใกล้ปากที่สุด
  const order: MultiplierTier[] = [5, 4, 3, 2, 1];
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

function zoneAt(zones: Zone[], t: number): MultiplierTier {
  const x = ((t % 1) + 1) % 1;
  for (const z of zones) {
    if (x >= z.start && x < z.end) return z.multiplier;
  }
  return zones[zones.length - 1]?.multiplier ?? 1;
}

export function PointsFeedBobaGame({
  mode,
  basePoints,
  weights = DEFAULT_SPIN_WEIGHTS,
  onComplete,
  className = "",
  hint,
}: Props) {
  const zones = buildZones(weights);
  const [phase, setPhase] = useState<"idle" | "running" | "done">(
    mode === "teaser" ? "running" : "idle",
  );
  const [pos, setPos] = useState(0.72);
  const [result, setResult] = useState<SpinResult | null>(null);
  const posRef = useRef(0.72);
  const dirRef = useRef(-1);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (mode !== "play") return;
    if (phase !== "idle" || result) return;
    const t = window.setTimeout(() => {
      setResult(null);
      setPhase("running");
      phaseRef.current = "running";
    }, 280);
    return () => window.clearTimeout(t);
  }, [mode, phase, result]);

  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (phaseRef.current === "running" || mode === "teaser") {
        // โยกไป-มา เร็วพอสำหรับ Gen-Z
        let p = posRef.current + dirRef.current * dt * (mode === "teaser" ? 0.22 : 0.38);
        if (p <= 0.02) {
          p = 0.02;
          dirRef.current = 1;
        } else if (p >= 0.98) {
          p = 0.98;
          dirRef.current = -1;
        }
        posRef.current = p;
        setPos(p);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  function start() {
    if (mode === "teaser") return;
    setResult(null);
    setPhase("running");
    phaseRef.current = "running";
  }

  function feed() {
    if (mode === "teaser") return;
    if (phaseRef.current !== "running") return;
    const mult = zoneAt(zones, posRef.current);
    const res = applyMultiplier(basePoints, mult);
    setResult(res);
    setPhase("done");
    phaseRef.current = "done";
    onComplete?.(res);
  }

  const liveMult = zoneAt(zones, pos);
  const livePrize = prizeForMultiplier(liveMult);

  return (
    <div className={`pts-game pts-feed ${className}`.trim()} data-mode={mode} data-phase={phase}>
      <div className="pts-game-head">
        <div className="pts-spin-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="pts-feed-logo-mark" width={48} height={48} />
        </div>
        <p className="pts-spin-title">ป้อนไข่มุก</p>
        <p className="pts-spin-sub">
          {mode === "teaser"
            ? "โยนไข่มุกเข้าปากหนุ่ม Tell Tea"
            : `แต้มฐาน ${Math.max(0, Math.trunc(basePoints))} · แตะตอนไข่มุกอยู่โซนดี`}
        </p>
      </div>

      <div className="pts-feed-stage">
        <div className="pts-feed-guy" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-telltea.svg" alt="" className="pts-feed-logo" />
          <span className="pts-feed-mouth-glow" />
        </div>

        <div className="pts-feed-lane">
          <div className="pts-feed-zones">
            {zones.map((z) => {
              const prize = prizeForMultiplier(z.multiplier);
              return (
                <div
                  key={z.multiplier}
                  className={`pts-feed-zone pts-spin-seg--${prize.tone}`}
                  style={{
                    left: `${z.start * 100}%`,
                    width: `${(z.end - z.start) * 100}%`,
                  }}
                  title={`×${z.multiplier} ${prize.shortLabel}`}
                >
                  <span>×{z.multiplier}</span>
                </div>
              );
            })}
          </div>
          <div
            className="pts-feed-pearl"
            style={{ left: `calc(${pos * 100}% - 0.7rem)` }}
            data-mult={liveMult}
          />
          <p className="pts-feed-live muted">
            ตอนนี้: ×{liveMult} {livePrize.shortLabel}
          </p>
        </div>
      </div>

      {mode !== "teaser" ? (
        <div className="pts-spin-actions">
          {phase === "idle" || phase === "done" ? (
            <button type="button" className="primary-btn pts-spin-btn" onClick={start}>
              {phase === "done" ? "ป้อนอีกเม็ด" : "เริ่มโยกไข่มุก"}
            </button>
          ) : null}
          {phase === "running" ? (
            <button type="button" className="primary-btn pts-spin-btn pts-spin-btn--stop" onClick={feed}>
              ป้อน!
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
        <p className="pts-spin-hint muted">โซนแคบใกล้ปาก = × สูง · ชิโอปังหายาก</p>
      ) : null}
    </div>
  );
}
