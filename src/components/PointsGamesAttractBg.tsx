"use client";

import { useEffect, useState } from "react";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { POINTS_GAMES } from "@/lib/points-games";
import {
  loadPointsSpinSettings,
  resolvePlaySettings,
  subscribePointsSpinSettings,
  type PointsSpinSettings,
} from "@/lib/points-spin-settings";

type Props = {
  basePoints?: number;
  settings?: PointsSpinSettings;
  /** หน้าลูกค้า — ตามค่าที่เจ้าของบันทึกแบบ realtime */
  liveSettings?: boolean;
  className?: string;
};

/**
 * พื้นหลังดึงดูดก่อนสมัคร/ล็อกอิน — โชว์วงล้อตามช่วงค่าตั้งร้าน (สุ่มชุดหนึ่ง)
 */
export function PointsGamesAttractBg({
  basePoints = 5,
  settings: settingsProp,
  liveSettings = false,
  className = "",
}: Props) {
  const [settings, setSettings] = useState<PointsSpinSettings | null>(null);

  useEffect(() => {
    if (settingsProp) {
      setSettings(resolvePlaySettings(settingsProp));
      return;
    }
    if (liveSettings) {
      return subscribePointsSpinSettings((s) => {
        setSettings(resolvePlaySettings(s));
      });
    }
    let cancelled = false;
    void loadPointsSpinSettings().then((s) => {
      if (!cancelled) setSettings(resolvePlaySettings(s));
    });
    return () => {
      cancelled = true;
    };
  }, [settingsProp, liveSettings]);

  return (
    <div className={`pts-attract ${className}`.trim()} aria-hidden>
      <div className="pts-attract-wash" />
      <div className="pts-attract-stack pts-attract-stack--single">
        <div className="pts-attract-panel pts-attract-panel--spin">
          <p className="pts-attract-tag">{POINTS_GAMES[0]!.attractLine}</p>
          {settings ? (
            <PointsMultiplierSpin
              key={`teaser-${settings.sliceCount}-${settings.spinSpeed}-${settings.stopDecel}-${settings.layoutSeed}-${settings.sliceSizing}-${settings.updatedAt}`}
              mode="teaser"
              basePoints={basePoints}
              weights={settings.weights}
              sliceCount={settings.sliceCount}
              spinSpeed={settings.spinSpeed}
              stopDecel={settings.stopDecel}
              sliceSizing={settings.sliceSizing}
              layoutSeed={settings.layoutSeed}
              hint=""
            />
          ) : (
            <p className="muted pts-attract-tag">กำลังโหลดวงล้อ…</p>
          )}
        </div>
      </div>
      <p className="pts-attract-banner">
        สมัครแล้วหมุนวงล้อ · กะจังหวะกดหยุดเอง · ลุ้นแต้มได้เพิ่ม 0–5
      </p>
    </div>
  );
}
