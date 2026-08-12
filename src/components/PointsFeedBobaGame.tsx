"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyMultiplier,
  type MultiplierTier,
  type SpinResult,
} from "@/lib/points-multiplier-spin";
import { POINTS_ONLY_NOTE, prizeForMultiplier } from "@/lib/points-spin-theme";
import { PointsGameBrandLogo } from "@/components/PointsGameBrandLogo";

export type PointsFeedMode = "teaser" | "play" | "demo";

type Props = {
  mode?: PointsFeedMode;
  basePoints: number;
  onComplete?: (result: SpinResult) => void;
  onSkip?: () => void;
  autoPlayMs?: number;
  hint?: string;
  className?: string;
};

type Zone = { mult: MultiplierTier; from: number; to: number };

const ZONES: Zone[] = [
  { mult: 1, from: 0, to: 0.42 },
  { mult: 2, from: 0.42, to: 0.68 },
  { mult: 3, from: 0.68, to: 0.84 },
  { mult: 4, from: 0.84, to: 0.94 },
  { mult: 5, from: 0.94, to: 1 },
];

function multAt(t: number): MultiplierTier {
  const x = ((t % 1) + 1) % 1;
  for (const z of ZONES) {
    if (x >= z.from && x < z.to) return z.mult;
  }
  return 1;
}

/**
 * จับจังหวะป้อนไข่มุก — ได้แค่คูณแต้ม (ไม่ใช่สินค้า)
 * โลโก้จาก brandLogo ที่อัปโหลดในบิล/ใบเสร็จ
 */
export function PointsFeedBobaGame({
  mode = "play",
  basePoints,
  onComplete,
  onSkip,
  autoPlayMs = 0,
  hint,
  className = "",
}: Props) {
  const isTeaser = mode === "teaser";
  const [running, setRunning] = useState(true);
  const [pos, setPos] = useState(0);
  const [done, setDone] = useState<MultiplierTier | null>(null);
  const [result, setResult] = useState<SpinResult | null>(null);
  const raf = useRef(0);
  const t0 = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if ((!running && !isTeaser) || done != null) return;
    t0.current = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - t0.current) / 1000;
      setPos((elapsed * 0.55) % 1);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running, done, isTeaser]);

  useEffect(() => {
    if (isTeaser || !autoPlayMs || done != null) return;
    const id = window.setTimeout(() => feed(), autoPlayMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlayMs, done, isTeaser]);

  function feed() {
    if (isTeaser || done != null) return;
    cancelAnimationFrame(raf.current);
    setRunning(false);
    const m = multAt(pos);
    const res = applyMultiplier(basePoints, m);
    setDone(m);
    setResult(res);
    window.setTimeout(() => {
      onCompleteRef.current?.(res);
    }, 900);
  }

  const preview = multAt(pos);
  const theme = done ? prizeForMultiplier(done) : null;

  return (
    <div
      className={`pts-game pts-feed pts-game--mobile ${className}`.trim()}
      data-mode={mode}
    >
      <div className="pts-game-head">
        <span className="pts-game-kicker">จับจังหวะ · คูณแต้ม</span>
        <h3 className="pts-game-title">ป้อนไข่มุก</h3>
        <p className="pts-game-sub">
          {isTeaser
            ? "ลุ้นคูณแต้ม ×1–×5 · ไม่ใช่ของแถม"
            : "แตะตอนเข็มชี้โซนที่ต้องการ — ได้แค่คูณแต้ม"}
        </p>
        {!isTeaser ? (
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
        ) : null}
      </div>

      <div className="pts-feed-stage" aria-hidden={isTeaser}>
        <div className="pts-feed-cup">
          <div className="pts-feed-cup-logo">
            <PointsGameBrandLogo className="pts-game-brand-logo" size={56} />
          </div>
          <div className="pts-feed-boba-stack">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="pts-feed-pearl-dot"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </div>
        </div>
        <div className="pts-feed-track">
          <div className="pts-feed-zones">
            {ZONES.map((z) => (
              <div
                key={z.mult}
                className={`pts-feed-zone pts-feed-zone--x${z.mult}`}
                style={{
                  left: `${z.from * 100}%`,
                  width: `${(z.to - z.from) * 100}%`,
                }}
              >
                ×{z.mult}
              </div>
            ))}
          </div>
          <div
            className="pts-feed-needle"
            style={{ left: `${pos * 100}%` }}
          />
        </div>
        {!isTeaser ? (
          <div className="pts-feed-live" aria-live="polite">
            ตอนนี้ → <strong>×{preview}</strong> แต้ม
          </div>
        ) : null}
      </div>

      {!isTeaser && done == null ? (
        <div className="pts-game-actions pts-spin-actions">
          <button type="button" className="primary-btn pts-spin-btn pts-spin-btn--stop" onClick={feed}>
            ป้อนเลย!
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
