"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyMultiplier,
  type MultiplierTier,
  type SpinResult,
} from "@/lib/points-multiplier-spin";
import { POINTS_ONLY_NOTE, prizeForMultiplier } from "@/lib/points-spin-theme";
import { PointsGameBrandLogo } from "@/components/PointsGameBrandLogo";

export type PointsPourMode = "teaser" | "play" | "demo";

type Props = {
  mode?: PointsPourMode;
  basePoints: number;
  onComplete?: (result: SpinResult) => void;
  onSkip?: () => void;
  autoPlayMs?: number;
  hint?: string;
  className?: string;
};

type Zone = { mult: MultiplierTier; from: number; to: number };

const ZONES: Zone[] = [
  { mult: 1, from: 0, to: 0.38 },
  { mult: 2, from: 0.38, to: 0.62 },
  { mult: 3, from: 0.62, to: 0.8 },
  { mult: 4, from: 0.8, to: 0.92 },
  { mult: 5, from: 0.92, to: 1 },
];

function multAt(fill: number): MultiplierTier {
  const x = Math.max(0, Math.min(0.999, fill));
  for (const z of ZONES) {
    if (x >= z.from && x < z.to) return z.mult;
  }
  return 1;
}

/**
 * กดค้างเทน้ำชา — ได้แค่คูณแต้ม (ไม่ใช่สินค้า)
 * โลโก้จาก brandLogo ที่อัปโหลดในบิล/ใบเสร็จ
 */
export function PointsPourTeaGame({
  mode = "play",
  basePoints,
  onComplete,
  onSkip,
  autoPlayMs = 0,
  hint,
  className = "",
}: Props) {
  const isTeaser = mode === "teaser";
  const [fill, setFill] = useState(isTeaser ? 0.55 : 0);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState<MultiplierTier | null>(null);
  const [result, setResult] = useState<SpinResult | null>(null);
  const raf = useRef(0);
  const last = useRef(0);
  const fillRef = useRef(isTeaser ? 0.55 : 0);
  const dirRef = useRef(1);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // ทีเซอร์: ระดับน้ำโยกขึ้นลงเอง
  useEffect(() => {
    if (!isTeaser) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      let next = fillRef.current + dirRef.current * dt * 0.28;
      if (next >= 0.92) {
        next = 0.92;
        dirRef.current = -1;
      } else if (next <= 0.12) {
        next = 0.12;
        dirRef.current = 1;
      }
      fillRef.current = next;
      setFill(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [isTeaser]);

  useEffect(() => {
    if (isTeaser || !holding || done != null) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      fillRef.current = Math.min(1, fillRef.current + dt * 0.42);
      setFill(fillRef.current);
      if (fillRef.current >= 1) {
        stopPour();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding, done, isTeaser]);

  useEffect(() => {
    if (isTeaser || !autoPlayMs || done != null) return;
    const start = window.setTimeout(() => setHolding(true), 200);
    const stop = window.setTimeout(() => stopPour(), autoPlayMs);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayMs, done, isTeaser]);

  function stopPour() {
    if (isTeaser || done != null) return;
    cancelAnimationFrame(raf.current);
    setHolding(false);
    const m = multAt(fillRef.current);
    const res = applyMultiplier(basePoints, m);
    setDone(m);
    setResult(res);
    window.setTimeout(() => {
      onCompleteRef.current?.(res);
    }, 900);
  }

  const preview = multAt(fill);
  const theme = done ? prizeForMultiplier(done) : null;

  return (
    <div
      className={`pts-game pts-pour pts-game--mobile ${className}`.trim()}
      data-mode={mode}
    >
      <div className="pts-game-head">
        <span className="pts-game-kicker">กดค้าง · คูณแต้ม</span>
        <h3 className="pts-game-title">เทชาไทย</h3>
        <p className="pts-game-sub">
          {isTeaser
            ? "ลุ้นคูณแต้ม ×1–×5 · ไม่ใช่ของแถม"
            : "กดค้างเติมน้ำชา ปล่อยตอนระดับที่ต้องการ — ได้แค่คูณแต้ม"}
        </p>
        {!isTeaser ? (
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
        ) : null}
      </div>

      <div className="pts-pour-stage" aria-hidden={isTeaser}>
        <div className="pts-pour-glass">
          <div className="pts-pour-marks">
            {ZONES.map((z) => (
              <div
                key={z.mult}
                className={`pts-pour-mark pts-pour-mark--x${z.mult}`}
                style={{
                  bottom: `${z.from * 100}%`,
                  height: `${(z.to - z.from) * 100}%`,
                }}
              >
                <span>×{z.mult}</span>
              </div>
            ))}
          </div>
          <div className="pts-pour-liquid" style={{ height: `${fill * 100}%` }} />
          <div className="pts-pour-glass-logo">
            <PointsGameBrandLogo className="pts-game-brand-logo" size={48} />
          </div>
        </div>
        {!isTeaser ? (
          <div className="pts-pour-live" aria-live="polite">
            ระดับนี้ → <strong>×{preview}</strong> แต้ม
          </div>
        ) : null}
      </div>

      {!isTeaser && done == null ? (
        <div className="pts-game-actions pts-spin-actions">
          <button
            type="button"
            className={`primary-btn pts-spin-btn pts-spin-btn--stop${holding ? " is-holding" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              if (done != null) return;
              fillRef.current = fill;
              setHolding(true);
            }}
            onPointerUp={stopPour}
            onPointerLeave={() => {
              if (holding) stopPour();
            }}
            onPointerCancel={stopPour}
          >
            {holding ? "ปล่อยเพื่อล็อก!" : "กดค้างเทชา"}
          </button>
          {onSkip ? (
            <button
              type="button"
              className="ghost-btn pts-spin-btn"
              onClick={onSkip}
            >
              ข้าม · ได้ ×1
            </button>
          ) : null}
        </div>
      ) : null}

      {!isTeaser && done != null && result ? (
        <div
          className={`pts-spin-result pts-spin-result--${theme?.tone}`}
          role="status"
        >
          <PointsGameBrandLogo className="pts-result-brand" size={44} />
          <p className="pts-spin-result-mult">×{done}</p>
          <p className="pts-spin-result-flavor">{theme?.label}</p>
          <p>
            {result.basePoints.toLocaleString("th-TH")} →{" "}
            <strong>{result.finalPoints.toLocaleString("th-TH")} แต้ม</strong>
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
        </div>
      ) : null}

      {hint ? <p className="pts-spin-hint muted">{hint}</p> : null}
    </div>
  );
}
