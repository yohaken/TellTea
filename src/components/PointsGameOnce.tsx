"use client";

import { useEffect, useState } from "react";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { PointsGameBrandLogo } from "@/components/PointsGameBrandLogo";
import { POINTS_ONLY_NOTE, prizeForPoints } from "@/lib/points-spin-theme";
import type { SpinResult } from "@/lib/points-multiplier-spin";
import type { PointsGameId } from "@/lib/points-games";
import {
  DEFAULT_POINTS_SPIN_SETTINGS,
  loadPointsSpinSettings,
  subscribePointsSpinSettings,
  type PointsSpinSettings,
} from "@/lib/points-spin-settings";

type Props = {
  basePoints?: number;
  /** ทับค่าตั้งจาก Firestore (โหมดจำลอง) */
  settings?: PointsSpinSettings;
  allowReselect?: boolean;
  /** เมื่อ true จะ subscribe ค่าตั้ง realtime (หน้าลูกค้า) */
  liveSettings?: boolean;
  onFinished?: (payload: { game: PointsGameId; result: SpinResult }) => void;
  /** ข้อความสถานะหลังเครดิตแต้ม */
  creditNote?: string | null;
  className?: string;
};

type Phase = "play" | "done";

/**
 * เล่นวงล้อเกมเดียวจนจบ — ใช้ค่าตั้งที่เจ้าของบันทึกไว้
 */
export function PointsGameOnce({
  basePoints = 0,
  settings: settingsProp,
  allowReselect = false,
  liveSettings = false,
  onFinished,
  creditNote = null,
  className = "",
}: Props) {
  const [loaded, setLoaded] = useState<PointsSpinSettings | null>(
    settingsProp || null,
  );
  const [phase, setPhase] = useState<Phase>("play");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (settingsProp) {
      setLoaded(settingsProp);
      return;
    }
    if (liveSettings) {
      return subscribePointsSpinSettings((s) => setLoaded(s));
    }
    let cancelled = false;
    void loadPointsSpinSettings().then((s) => {
      if (!cancelled) setLoaded(s);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsProp, liveSettings]);

  const settings = loaded || DEFAULT_POINTS_SPIN_SETTINGS;

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
            กะจังหวะกดหยุด · ช่องใหญ่พอเห็น · ได้แต้มคงที่ 1–5
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
          <PointsMultiplierSpin
            key={`${playKey}-${settings.sliceCount}-${settings.spinSpeed}-${settings.stopDecel}`}
            mode="play"
            basePoints={basePoints}
            weights={settings.weights}
            sliceCount={settings.sliceCount}
            spinSpeed={settings.spinSpeed}
            stopDecel={settings.stopDecel}
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
          {creditNote ? <p className="muted pts-once-lock-note">{creditNote}</p> : null}
          {!creditNote ? <p className="muted pts-once-lock-note">รอบนี้หมุนไปแล้ว</p> : null}
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
