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
  resolvePlaySettings,
  subscribePointsSpinSettings,
  type PointsSpinSettings,
} from "@/lib/points-spin-settings";

type Props = {
  basePoints?: number;
  /**
   * ทับค่าตั้งจาก Firestore (โหมดจำลอง)
   * จะถูก resolvePlaySettings ครั้งแรกแล้วล็อกจนจบรอบ
   */
  settings?: PointsSpinSettings | null;
  allowReselect?: boolean;
  /**
   * โหลดค่าตั้ง realtime ครั้งแรกแล้วล็อก — ไม่เปลี่ยนวงกลางเกม
   * (อย่าส่ง settings พร้อมกันถ้าต้องการโหมดนี้)
   */
  liveSettings?: boolean;
  onFinished?: (payload: { game: PointsGameId; result: SpinResult }) => void;
  /** ข้อความสถานะหลังเครดิตแต้ม */
  creditNote?: string | null;
  /** โชว์ปุ่มบันทึกแต้มอีกครั้งเมื่อเครดิตล้ม */
  creditRetryable?: boolean;
  onRetryCredit?: () => void;
  className?: string;
};

type Phase = "play" | "done";

function latchPlay(base: PointsSpinSettings): PointsSpinSettings {
  return resolvePlaySettings(base);
}

/**
 * เล่นวงล้อเกมเดียวจนจบ — สุ่มค่าเล่นจากช่วงที่เจ้าของตั้งไว้ แล้วล็อกในรอบ
 */
export function PointsGameOnce({
  basePoints = 0,
  settings: settingsProp,
  allowReselect = false,
  liveSettings = false,
  onFinished,
  creditNote = null,
  creditRetryable = false,
  onRetryCredit,
  className = "",
}: Props) {
  const [frozen, setFrozen] = useState<PointsSpinSettings | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("play");
  const [result, setResult] = useState<SpinResult | null>(null);
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (settingsProp) {
      setFrozen((prev) => prev ?? latchPlay(settingsProp));
      setSettingsReady(true);
      return;
    }
    if (liveSettings) {
      return subscribePointsSpinSettings((s) => {
        setFrozen((prev) => prev ?? latchPlay(s));
        setSettingsReady(true);
      });
    }
    let cancelled = false;
    void loadPointsSpinSettings().then((s) => {
      if (cancelled) return;
      setFrozen((prev) => prev ?? latchPlay(s));
      setSettingsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsProp, liveSettings]);

  const settings = frozen || DEFAULT_POINTS_SPIN_SETTINGS;

  function onComplete(res: SpinResult) {
    setResult(res);
    setPhase("done");
    onFinished?.({ game: "spin", result: res });
  }

  function resetPlay() {
    if (!allowReselect) return;
    const base = settingsProp || frozen || DEFAULT_POINTS_SPIN_SETTINGS;
    // สุ่มชุดใหม่จากช่วงเดิม (ไม่ล็อกค่าที่ resolve แล้ว)
    const template: PointsSpinSettings = {
      ...base,
      sliceCountMin: base.sliceCountMin,
      sliceCountMax: base.sliceCountMax,
      spinSpeedMin: base.spinSpeedMin,
      spinSpeedMax: base.spinSpeedMax,
      stopDecelMin: base.stopDecelMin,
      stopDecelMax: base.stopDecelMax,
      shuffleLayout: base.shuffleLayout,
      sliceSizing: base.sliceSizing,
      layoutSeed: 0,
    };
    setFrozen(latchPlay(template));
    setPhase("play");
    setResult(null);
    setPlayKey((k) => k + 1);
  }

  const prize = result ? prizeForPoints(result.points) : null;

  if (!settingsReady) {
    return (
      <div className={`pts-once pts-once--mobile ${className}`.trim()}>
        <p className="muted pts-once-sub">กำลังโหลดวงล้อ…</p>
      </div>
    );
  }

  return (
    <div className={`pts-once pts-once--mobile ${className}`.trim()} data-phase={phase}>
      {phase === "play" ? (
        <div className="pts-once-play">
          <p className="pts-once-title">หมุนวงล้อลุ้นแต้มได้เพิ่ม</p>
          <p className="pts-once-sub muted">
            กะจังหวะกดหยุด · ลุ้นแต้มได้เพิ่ม 0–5 (+0 = ไม่ได้เพิ่มจากเกม)
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
          <PointsMultiplierSpin
            key={`${playKey}-${settings.sliceCount}-${settings.spinSpeed}-${settings.stopDecel}-${settings.layoutSeed}-${settings.sliceSizing}`}
            mode="play"
            basePoints={basePoints}
            weights={settings.weights}
            sliceCount={settings.sliceCount}
            spinSpeed={settings.spinSpeed}
            stopDecel={settings.stopDecel}
            sliceSizing={settings.sliceSizing}
            layoutSeed={settings.layoutSeed}
            onComplete={onComplete}
          />
        </div>
      ) : null}

      {phase === "done" && result ? (
        <div className="pts-once-done">
          <PointsGameBrandLogo className="pts-result-brand" size={52} />
          <p className="pts-once-title">จบเกม · หมุนวงล้อ</p>
          <p className="pts-spin-result-mult">
            {result.points === 0 ? "+0" : `+${result.points}`}
          </p>
          <p className="pts-spin-result-flavor">{prize?.label}</p>
          <p>
            {result.points === 0 ? (
              <>
                รอบนี้<strong>ไม่ได้แต้มเพิ่มจากเกม</strong>
                <span className="muted"> · แต้มเดิมยังอยู่ครบ</span>
              </>
            ) : (
              <>
                ได้เพิ่ม <strong>{result.finalPoints}</strong> แต้ม
              </>
            )}
          </p>
          <p className="pts-spin-points-only">{POINTS_ONLY_NOTE}</p>
          {creditNote ? <p className="muted pts-once-lock-note">{creditNote}</p> : null}
          {!creditNote ? <p className="muted pts-once-lock-note">รอบนี้หมุนไปแล้ว</p> : null}
          {creditRetryable && onRetryCredit ? (
            <button
              type="button"
              className="primary-btn pts-spin-btn"
              onClick={onRetryCredit}
            >
              บันทึกแต้มอีกครั้ง
            </button>
          ) : null}
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
