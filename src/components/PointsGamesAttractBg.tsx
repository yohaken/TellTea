"use client";

import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { PointsFeedBobaGame } from "@/components/PointsFeedBobaGame";
import { PointsPourTeaGame } from "@/components/PointsPourTeaGame";
import { POINTS_GAMES } from "@/lib/points-games";

type Props = {
  /** แต้มตัวอย่างบนทีเซอร์ */
  basePoints?: number;
  className?: string;
};

/**
 * พื้นหลังดึงดูดก่อนสมัคร/ล็อกอิน — โชว์ 3 เกมเคลื่อนไหวพร้อมกัน
 * ไม่ให้แตะเล่น (pointer-events: none)
 */
export function PointsGamesAttractBg({ basePoints = 5, className = "" }: Props) {
  return (
    <div className={`pts-attract ${className}`.trim()} aria-hidden>
      <div className="pts-attract-wash" />
      <div className="pts-attract-stack">
        <div className="pts-attract-panel pts-attract-panel--spin">
          <p className="pts-attract-tag">{POINTS_GAMES[0]!.attractLine}</p>
          <PointsMultiplierSpin mode="teaser" basePoints={basePoints} hint="" />
        </div>
        <div className="pts-attract-panel pts-attract-panel--feed">
          <p className="pts-attract-tag">{POINTS_GAMES[1]!.attractLine}</p>
          <PointsFeedBobaGame mode="teaser" basePoints={basePoints} hint="" />
        </div>
        <div className="pts-attract-panel pts-attract-panel--pour">
          <p className="pts-attract-tag">{POINTS_GAMES[2]!.attractLine}</p>
          <PointsPourTeaGame mode="teaser" basePoints={basePoints} hint="" />
        </div>
      </div>
      <p className="pts-attract-banner">สมัครแล้วเลือกเล่นได้ 1 เกม · ลุ้นคูณแต้ม ×1–×5</p>
    </div>
  );
}
