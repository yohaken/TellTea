"use client";

import { useState } from "react";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { PointsFeedBobaGame } from "@/components/PointsFeedBobaGame";
import { PointsPourTeaGame } from "@/components/PointsPourTeaGame";
import { SpinPrizeIcon } from "@/components/PointsSpinThemeIcons";
import {
  POINTS_GAMES,
  pointsGameById,
  type PointsGameId,
} from "@/lib/points-games";
import { SPIN_MENU_PRIZES } from "@/lib/points-spin-theme";
import type { SpinResult } from "@/lib/points-multiplier-spin";

type Props = {
  basePoints: number;
  /** โหมดจำลองหลังร้าน — อนุญาตรีเซ็ตเลือกใหม่ */
  allowReselect?: boolean;
  onFinished?: (payload: { game: PointsGameId; result: SpinResult }) => void;
  className?: string;
};

type Phase = "pick" | "play" | "done";

/**
 * ลูกค้าเลือกได้เพียง 1 เกมต่อรอบ แล้วเล่นจนจบ
 */
export function PointsGameOnce({
  basePoints,
  allowReselect = false,
  onFinished,
  className = "",
}: Props) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [game, setGame] = useState<PointsGameId | null>(null);
  const [result, setResult] = useState<SpinResult | null>(null);

  function pick(id: PointsGameId) {
    setGame(id);
    setResult(null);
    setPhase("play");
  }

  function onComplete(res: SpinResult) {
    setResult(res);
    setPhase("done");
    if (game) onFinished?.({ game, result: res });
  }

  function resetPick() {
    if (!allowReselect) return;
    setPhase("pick");
    setGame(null);
    setResult(null);
  }

  const info = game ? pointsGameById(game) : null;

  return (
    <div className={`pts-once ${className}`.trim()} data-phase={phase}>
      {phase === "pick" ? (
        <div className="pts-once-pick">
          <p className="pts-once-title">เลือก 1 เกมลุ้นคูณแต้ม</p>
          <p className="pts-once-sub muted">
            แต้มฐาน <strong>{Math.max(0, Math.trunc(basePoints))}</strong> · เลือกแล้วเล่นเกมนั้นอย่างเดียว
          </p>
          <div className="pts-once-choices">
            {POINTS_GAMES.map((g) => (
              <button
                key={g.id}
                type="button"
                className="pts-once-choice"
                onClick={() => pick(g.id)}
              >
                <span className="pts-once-choice-title">{g.title}</span>
                <span className="pts-once-choice-blurb">{g.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {phase === "play" && game ? (
        <div className="pts-once-play">
          <p className="pts-once-playing muted">กำลังเล่น · {info?.title}</p>
          {game === "spin" ? (
            <PointsMultiplierSpin mode="play" basePoints={basePoints} onComplete={onComplete} />
          ) : null}
          {game === "feed" ? (
            <PointsFeedBobaGame mode="play" basePoints={basePoints} onComplete={onComplete} />
          ) : null}
          {game === "pour" ? (
            <PointsPourTeaGame mode="play" basePoints={basePoints} onComplete={onComplete} />
          ) : null}
        </div>
      ) : null}

      {phase === "done" && result && info ? (
        <div className="pts-once-done">
          <p className="pts-once-title">จบเกม · {info.shortTitle}</p>
          <div className="pts-spin-result-prize">
            <SpinPrizeIcon multiplier={result.multiplier} />
          </div>
          <p className="pts-spin-result-mult">×{result.multiplier}</p>
          <p className="pts-spin-result-flavor">
            {SPIN_MENU_PRIZES[result.multiplier].label}
          </p>
          <p>
            {result.basePoints} → <strong>{result.finalPoints}</strong> แต้ม
            {result.bonusPoints > 0 ? (
              <span className="pts-spin-bonus"> (+{result.bonusPoints})</span>
            ) : null}
          </p>
          <p className="muted pts-once-lock-note">รอบนี้เลือกเกมไปแล้ว · ไม่เปลี่ยนเกมได้</p>
          {allowReselect ? (
            <button type="button" className="ghost-btn pts-spin-btn" onClick={resetPick}>
              จำลอง: เลือกเกมใหม่
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
