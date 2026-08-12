"use client";

import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { POINTS_GAMES } from "@/lib/points-games";

type Props = {
  basePoints?: number;
  className?: string;
};

/**
 * พื้นหลังดึงดูดก่อนสมัคร/ล็อกอิน — โชว์วงล้อเคลื่อนไหว
 * ไม่ให้แตะเล่น (pointer-events: none)
 */
export function PointsGamesAttractBg({ basePoints = 5, className = "" }: Props) {
  return (
    <div className={`pts-attract ${className}`.trim()} aria-hidden>
      <div className="pts-attract-wash" />
      <div className="pts-attract-stack pts-attract-stack--single">
        <div className="pts-attract-panel pts-attract-panel--spin">
          <p className="pts-attract-tag">{POINTS_GAMES[0]!.attractLine}</p>
          <PointsMultiplierSpin mode="teaser" basePoints={basePoints} hint="" />
        </div>
      </div>
      <p className="pts-attract-banner">
        สมัครแล้วหมุนวงล้อลุ้นได้ 1–5 แต้ม · ไม่ใช่ของแถม
      </p>
    </div>
  );
}
