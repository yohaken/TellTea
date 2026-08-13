"use client";

import { useEffect, useState } from "react";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { POINTS_GAMES } from "@/lib/points-games";
import {
  DEFAULT_POINTS_SPIN_SETTINGS,
  loadPointsSpinSettings,
  type PointsSpinSettings,
} from "@/lib/points-spin-settings";

type Props = {
  basePoints?: number;
  settings?: PointsSpinSettings;
  className?: string;
};

/**
 * พื้นหลังดึงดูดก่อนสมัคร/ล็อกอิน — โชว์วงล้อตามค่าตั้งร้าน
 */
export function PointsGamesAttractBg({
  basePoints = 5,
  settings: settingsProp,
  className = "",
}: Props) {
  const [settings, setSettings] = useState<PointsSpinSettings>(
    settingsProp || DEFAULT_POINTS_SPIN_SETTINGS,
  );

  useEffect(() => {
    if (settingsProp) {
      setSettings(settingsProp);
      return;
    }
    let cancelled = false;
    void loadPointsSpinSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, [settingsProp]);

  return (
    <div className={`pts-attract ${className}`.trim()} aria-hidden>
      <div className="pts-attract-wash" />
      <div className="pts-attract-stack pts-attract-stack--single">
        <div className="pts-attract-panel pts-attract-panel--spin">
          <p className="pts-attract-tag">{POINTS_GAMES[0]!.attractLine}</p>
          <PointsMultiplierSpin
            mode="teaser"
            basePoints={basePoints}
            weights={settings.weights}
            sliceCount={settings.sliceCount}
            spinSpeed={settings.spinSpeed}
            stopDecel={settings.stopDecel}
            hint=""
          />
        </div>
      </div>
      <p className="pts-attract-banner">
        สมัครแล้วหมุนวงล้อ · กะจังหวะกดหยุดเอง · ได้ 1–5 แต้ม
      </p>
    </div>
  );
}
