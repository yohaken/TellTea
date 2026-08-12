"use client";

import { useState } from "react";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { PointsGameBrandLogo } from "@/components/PointsGameBrandLogo";
import { POINTS_ONLY_NOTE, prizeForPoints } from "@/lib/points-spin-theme";
import type { SpinResult } from "@/lib/points-multiplier-spin";
import type { PointsGameId } from "@/lib/points-games";

type Props = {
  basePoints?: number;
  /** โหมดจำลองหลังร้าน — อนุญาตหมุนใหม่ */
  allowReselect?: boolean;
  onFinished?: (payload: { game: PointsGameId; result: SpinResult }) => void;
  className?: string;
};

type Phase = "play" | "done";

/**
 * เล่นวงล้อเกมเดียวจนจบ (ไม่มีตัวเลือกหลายเกม)
 */
export function PointsGameOnce({
  basePoints = 0,
  allowReselect = false,
  onFinished,
  className = "",
}: Props) {
  const [phase, setPhase] = useState<Phase>("play");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [playKey, setPlayKey] = useState(0);

  function onComplete(res: SpinResult) {
    setResult(res);
    setPhase("done");
    onFinished?.({ game: "spin", result: res });
  }

  function resetPlay() {
    if (!allowReselect) return;
    setPhase("play");
    setResult(null);
    setPlayKey((k) => k + 1);
  }

  const prize = result ? prizeForPoints(result.points) : null;

  return (
    <div className={`pts-once pts-once--mobile ${className}`.trim()} data-phase={phase}>
      {phase === "play" ? (
        <div className="pts-once-play">
          <p className="pts-once-title">หมุนวงล้อลุ้นแต้ม</p>
          <p className="pts-once-sub muted">
            กดหยุดแล้ววงล้อหน่วงตามแรง · ได้แต้มคงที่ 1–5
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
          <PointsMultiplierSpin
            key={playKey}
            mode="play"
            basePoints={basePoints}
            onComplete={onComplete}
          />
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div className="pts-once-done">
          <PointsGameBrandLogo className="pts-result-brand" size={52} />
          <p className="pts-once-title">จบเกม · หมุนวงล้อ</p>
          <p className="pts-spin-result-mult">+{result.points}</p>
          <p className="pts-spin-result-flavor">{prize?.label}</p>
          <p>
            ได้ <strong>{result.finalPoints}</strong> แต้ม
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
          <p className="muted pts-once-lock-note">รอบนี้หมุนไปแล้ว</p>
          {allowReselect ? (
            <button
              type="button"
              className="ghost-btn pts-spin-btn"
              onClick={resetPlay}
            >
              จำลอง: หมุนใหม่
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
