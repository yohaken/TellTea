"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { PointsFeedBobaGame } from "@/components/PointsFeedBobaGame";
import { PointsPourTeaGame } from "@/components/PointsPourTeaGame";
import { useAuth } from "@/lib/auth";
import { canAccessMembersHub } from "@/lib/permissions";
import {
  DEFAULT_SPIN_WEIGHTS,
  MULTIPLIER_TIERS,
  expectedMultiplier,
  formatPercent,
  probabilityMap,
  simulateSpins,
  type MultiplierTier,
  type SpinWeight,
} from "@/lib/points-multiplier-spin";
import { SPIN_MENU_PRIZES } from "@/lib/points-spin-theme";

type GameId = "spin" | "feed" | "pour";

const GAMES: { id: GameId; title: string; desc: string }[] = [
  {
    id: "spin",
    title: "1) หมุนกระดานเมนู",
    desc: "ชาไทย · ชานมไข่มุก · ซอฟคุกกี้ · บราวนี่ · ชิโอปัง — กดหยุด",
  },
  {
    id: "feed",
    title: "2) ป้อนไข่มุก",
    desc: "โยนไข่มุกเข้าปากหนุ่มในโลโก้ Tell Tea — โซนแคบใกล้ปาก = × สูง",
  },
  {
    id: "pour",
    title: "3) เทชาไทยให้พอดี",
    desc: "กดค้างเทชา · ปล่อยตอนระดับที่อยากได้ — ปากแก้ว = ×5",
  },
];

export default function MembersSpinDemoPage() {
  return (
    <AuthGate>
      <SpinDemoView />
    </AuthGate>
  );
}

function SpinDemoView() {
  const { staff } = useAuth();
  const canHub = canAccessMembersHub(staff);

  const [game, setGame] = useState<GameId>("spin");
  const [basePoints, setBasePoints] = useState(8);
  const [w1, setW1] = useState(50);
  const [w2, setW2] = useState(28);
  const [w3, setW3] = useState(14);
  const [w4, setW4] = useState(6);
  const [w5, setW5] = useState(2);
  const [simCount, setSimCount] = useState<Record<MultiplierTier, number> | null>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);

  const weights: SpinWeight[] = useMemo(
    () => [
      { multiplier: 1, weight: w1 },
      { multiplier: 2, weight: w2 },
      { multiplier: 3, weight: w3 },
      { multiplier: 4, weight: w4 },
      { multiplier: 5, weight: w5 },
    ],
    [w1, w2, w3, w4, w5],
  );

  const probs = useMemo(() => probabilityMap(weights), [weights]);
  const ev = useMemo(() => expectedMultiplier(weights), [weights]);
  const setters: Record<MultiplierTier, (n: number) => void> = {
    1: setW1,
    2: setW2,
    3: setW3,
    4: setW4,
    5: setW5,
  };
  const values: Record<MultiplierTier, number> = {
    1: w1,
    2: w2,
    3: w3,
    4: w4,
    5: w5,
  };

  if (!canHub) {
    return (
      <div className="staff-hub members-hub">
        <p className="staff-hub-msg" style={{ color: "var(--danger, #b42318)" }}>
          หน้านี้สำหรับเจ้าของ / ผู้จัดการสมาชิก
        </p>
        <Link href="/">กลับหน้าหลัก</Link>
      </div>
    );
  }

  const gameKey = `${game}-${basePoints}-${w1}-${w2}-${w3}-${w4}-${w5}`;

  return (
    <div className="staff-hub members-hub members-hub--slim pts-spin-demo">
      <header className="staff-hub-head members-slim-head">
        <h1 className="staff-hub-title">จำลองเกมคูณแต้ม</h1>
        <div className="staff-hub-head-actions">
          <Link href="/members/" className="ghost-btn staff-btn-sm">
            ← สมาชิก
          </Link>
        </div>
      </header>

      <section className="staff-hub-panel members-slim-panel">
        <p className="members-slim-hint muted">
          โหมดจำลองหลังร้าน — ไม่แตะแต้มลูกค้าจริง · ชุด 3 เกมธีมชาไข่มุก + ขนม Tell Tea
          (กลุ่มอายุ ~15–25)
        </p>

        <p className="pts-spin-demo-weights-title">เลือกเกม</p>
        <div className="pts-spin-demo-games">
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`pts-spin-demo-game-card${game === g.id ? " is-active" : ""}`}
              onClick={() => {
                setGame(g.id);
                setLastNote(null);
              }}
            >
              <strong>{g.title}</strong>
              <span>{g.desc}</span>
            </button>
          ))}
        </div>

        <label className="pts-spin-demo-field">
          <span>แต้มฐาน (สมมติได้จากบิล)</span>
          <input
            type="number"
            min={1}
            max={9999}
            step={1}
            value={basePoints}
            onChange={(e) => setBasePoints(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
          />
        </label>

        <div className="pts-spin-demo-weights">
          <p className="pts-spin-demo-weights-title">ความกว้าง / โอกาสแต่ละขั้น</p>
          {MULTIPLIER_TIERS.map((m) => (
            <label key={m} className="pts-spin-demo-weight-row">
              <span className="pts-spin-demo-weight-label">×{m}</span>
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={values[m]}
                onChange={(e) => setters[m](Number(e.target.value))}
              />
              <input
                type="number"
                min={0}
                max={200}
                className="pts-spin-demo-weight-num"
                value={values[m]}
                onChange={(e) => setters[m](Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="muted pts-spin-demo-pct">
                {formatPercent(probs[m])} · {SPIN_MENU_PRIZES[m].shortLabel}
              </span>
            </label>
          ))}
          <p className="members-slim-hint muted">
            ค่าคาดหวังตัวคูณ ≈ <strong>{ev.toFixed(2)}</strong>× · ค่าเริ่ม EV ≈{" "}
            {expectedMultiplier(DEFAULT_SPIN_WEIGHTS).toFixed(2)}×
          </p>
          <button
            type="button"
            className="ghost-btn staff-btn-sm"
            onClick={() => {
              setW1(50);
              setW2(28);
              setW3(14);
              setW4(6);
              setW5(2);
              setSimCount(null);
            }}
          >
            รีเซ็ตน้ำหนักค่าเริ่ม
          </button>
        </div>
      </section>

      <section className="staff-hub-panel members-slim-panel">
        {game === "spin" ? (
          <PointsMultiplierSpin
            key={gameKey}
            mode="demo"
            basePoints={basePoints}
            weights={weights}
            hint="กดเริ่มหมุน → กดหยุด · เมนูชิ้นแคบ = ยาก"
            onComplete={(r) => {
              setLastNote(
                `หมุนเมนู · ×${r.multiplier} ${SPIN_MENU_PRIZES[r.multiplier].label} · ${r.basePoints}→${r.finalPoints}`,
              );
            }}
          />
        ) : null}
        {game === "feed" ? (
          <PointsFeedBobaGame
            key={gameKey}
            mode="demo"
            basePoints={basePoints}
            weights={weights}
            hint="แตะป้อนตอนไข่มุกอยู่ในโซน · ใกล้ปาก = × สูง"
            onComplete={(r) => {
              setLastNote(
                `ป้อนไข่มุก · ×${r.multiplier} ${SPIN_MENU_PRIZES[r.multiplier].label} · ${r.basePoints}→${r.finalPoints}`,
              );
            }}
          />
        ) : null}
        {game === "pour" ? (
          <PointsPourTeaGame
            key={gameKey}
            mode="demo"
            basePoints={basePoints}
            weights={weights}
            hint="กดค้างเทชา แล้วปล่อย · อย่าล้นปากแก้ว"
            onComplete={(r) => {
              setLastNote(
                `เทชาไทย · ×${r.multiplier} ${SPIN_MENU_PRIZES[r.multiplier].label} · ${r.basePoints}→${r.finalPoints}`,
              );
            }}
          />
        ) : null}
        {lastNote ? <p className="members-slim-msg">{lastNote}</p> : null}
      </section>

      <section className="staff-hub-panel members-slim-panel">
        <p className="pts-spin-demo-weights-title">จำลองสุ่ม 2,000 ครั้ง (น้ำหนักเดียวกันทั้ง 3 เกม)</p>
        <button
          type="button"
          className="primary-btn staff-btn-sm"
          onClick={() => setSimCount(simulateSpins(2000, weights))}
        >
          รันจำลอง
        </button>
        {simCount ? (
          <ul className="pts-spin-demo-hist">
            {MULTIPLIER_TIERS.map((m) => {
              const n = simCount[m];
              const pct = (n / 2000) * 100;
              return (
                <li key={m}>
                  <span>×{m}</span>
                  <span className="pts-spin-demo-bar">
                    <i style={{ width: `${Math.min(100, pct)}%` }} />
                  </span>
                  <span>
                    {n} ({pct.toFixed(1)}%) · {SPIN_MENU_PRIZES[m].shortLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted members-slim-hint">กดรันเพื่อเทียบกับเปอร์เซ็นต์ที่ตั้ง</p>
        )}
      </section>

      <section className="staff-hub-panel members-slim-panel">
        <p className="pts-spin-demo-weights-title">ทำไมชุดนี้เข้ากลุ่ม 15–25</p>
        <ol className="pts-spin-demo-flow">
          <li>
            <strong>หมุนเมนู</strong> — เห็นสินค้าจริงของร้าน เล่นง่าย ถ่ายสตอรี่ได้
          </li>
          <li>
            <strong>ป้อนไข่มุก</strong> — ใช้ตัวละครผู้ชายในโลโก้ · น่ารัก ไม่เด็กเกิน
          </li>
          <li>
            <strong>เทชาไทย</strong> — ทักษะกดค้างแบบเกมมือถือสั้นๆ · จบใน 3 วินาที
          </li>
        </ol>
        <p className="muted members-slim-hint">
          ลิงก์นี้: <code>/members/spin-demo/</code> · รายละเอียด{" "}
          <code>docs/members-points-spin.md</code>
        </p>
      </section>
    </div>
  );
}
