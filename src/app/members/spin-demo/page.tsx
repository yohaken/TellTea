"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { PointsFeedBobaGame } from "@/components/PointsFeedBobaGame";
import { PointsPourTeaGame } from "@/components/PointsPourTeaGame";
import { PointsGamesAttractBg } from "@/components/PointsGamesAttractBg";
import { PointsGameOnce } from "@/components/PointsGameOnce";
import { useAuth } from "@/lib/auth";
import { canAccessMembersHub } from "@/lib/permissions";
import { POINTS_GAMES, type PointsGameId } from "@/lib/points-games";
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

type DemoTab = "customer" | PointsGameId;

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

  const [tab, setTab] = useState<DemoTab>("customer");
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

  const gameKey = `${tab}-${basePoints}-${w1}-${w2}-${w3}-${w4}-${w5}`;

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
          โหมดจำลองหลังร้าน — ไม่แตะแต้มลูกค้าจริง · ลูกค้าเลือกได้{" "}
          <strong>1 เกมเท่านั้น</strong> ต่อรอบ
        </p>

        <p className="pts-spin-demo-weights-title">โหมดดู</p>
        <div className="pts-spin-demo-games">
          <button
            type="button"
            className={`pts-spin-demo-game-card${tab === "customer" ? " is-active" : ""}`}
            onClick={() => {
              setTab("customer");
              setLastNote(null);
            }}
          >
            <strong>โฟลว์ลูกค้า (แนะนำ)</strong>
            <span>พื้นหลัง 3 เกมเคลื่อนไหว → เลือกเล่นได้แค่ 1 เกม</span>
          </button>
          {POINTS_GAMES.map((g, i) => (
            <button
              key={g.id}
              type="button"
              className={`pts-spin-demo-game-card${tab === g.id ? " is-active" : ""}`}
              onClick={() => {
                setTab(g.id);
                setLastNote(null);
              }}
            >
              <strong>
                {i + 1}) {g.title}
              </strong>
              <span>{g.blurb}</span>
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
        {tab === "customer" ? (
          <div>
            <p className="pts-spin-demo-weights-title">1) พื้นหลังตอนสมัคร/ล็อกอิน</p>
            <div className="pts-attract-demo-frame join-page join-page--attract">
              <PointsGamesAttractBg key={`bg-${gameKey}`} basePoints={basePoints} />
              <div className="join-card" style={{ margin: "2.5rem auto", position: "relative" }}>
                <p className="join-brand">TellTea</p>
                <h1 style={{ fontSize: "1.1rem", margin: 0 }}>สมัครสมาชิก</h1>
                <p className="muted" style={{ marginTop: "0.35rem" }}>
                  ด้านหลังมีเกมกำลังเล่นอยู่ · สมัครแล้วเลือกได้ <strong>1 เกม</strong>
                </p>
              </div>
            </div>
            <p className="pts-spin-demo-weights-title" style={{ marginTop: "1rem" }}>
              2) หลังได้แต้ม — เลือกได้แค่ 1 เกม
            </p>
            <PointsGameOnce
              key={`once-${gameKey}`}
              basePoints={basePoints}
              allowReselect
              onFinished={({ game, result }) => {
                setLastNote(
                  `ลูกค้าเลือก ${game} · ×${result.multiplier} ${SPIN_MENU_PRIZES[result.multiplier].label} · ${result.basePoints}→${result.finalPoints}`,
                );
              }}
            />
          </div>
        ) : null}
        {tab === "spin" ? (
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
        {tab === "feed" ? (
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
        {tab === "pour" ? (
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
        <p className="pts-spin-demo-weights-title">กฎลูกค้า</p>
        <ol className="pts-spin-demo-flow">
          <li>ก่อนสมัคร/ล็อกอิน — เห็น 3 เกมเคลื่อนไหวเป็นพื้นหลัง (ยังเล่นไม่ได้)</li>
          <li>รับแต้มฐานแล้ว — เลือกได้ <strong>เพียง 1 เกม</strong> ต่อรอบ</li>
          <li>เลือกแล้วเปลี่ยนเกมไม่ได้ · จบแล้วไปดูแต้ม</li>
        </ol>
        <p className="muted members-slim-hint">
          ลิงก์นี้: <code>/members/spin-demo/</code> · รายละเอียด{" "}
          <code>docs/members-points-spin.md</code>
        </p>
      </section>
    </div>
  );
}
