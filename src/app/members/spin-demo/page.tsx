"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { PointsMultiplierSpin } from "@/components/PointsMultiplierSpin";
import { PointsGamesAttractBg } from "@/components/PointsGamesAttractBg";
import { PointsGameOnce } from "@/components/PointsGameOnce";
import { useAuth } from "@/lib/auth";
import { canAccessMembersHub } from "@/lib/permissions";
import {
  DEFAULT_SPIN_WEIGHTS,
  POINT_TIERS,
  expectedPoints,
  formatPercent,
  probabilityMap,
  simulatePhysicsCoasts,
  simulateSpins,
  type PointTier,
  type SpinWeight,
} from "@/lib/points-multiplier-spin";
import { SPIN_MENU_PRIZES } from "@/lib/points-spin-theme";

type DemoTab = "customer" | "spin";

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
  const [w1, setW1] = useState(50);
  const [w2, setW2] = useState(28);
  const [w3, setW3] = useState(14);
  const [w4, setW4] = useState(6);
  const [w5, setW5] = useState(2);
  const [simCount, setSimCount] = useState<Record<PointTier, number> | null>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);

  const weights: SpinWeight[] = useMemo(
    () => [
      { points: 1, weight: w1 },
      { points: 2, weight: w2 },
      { points: 3, weight: w3 },
      { points: 4, weight: w4 },
      { points: 5, weight: w5 },
    ],
    [w1, w2, w3, w4, w5],
  );

  const probs = useMemo(() => probabilityMap(weights), [weights]);
  const ev = useMemo(() => expectedPoints(weights), [weights]);
  const setters: Record<PointTier, (n: number) => void> = {
    1: setW1,
    2: setW2,
    3: setW3,
    4: setW4,
    5: setW5,
  };
  const values: Record<PointTier, number> = {
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

  const gameKey = `${tab}-${w1}-${w2}-${w3}-${w4}-${w5}`;

  return (
    <div className="staff-hub members-hub members-hub--slim pts-spin-demo">
      <header className="staff-hub-head members-slim-head">
        <h1 className="staff-hub-title">จำลองหมุนวงล้อลุ้นแต้ม</h1>
        <div className="staff-hub-head-actions">
          <Link href="/members/" className="ghost-btn staff-btn-sm">
            ← สมาชิก
          </Link>
        </div>
      </header>

      <section className="staff-hub-panel members-slim-panel">
        <p className="pts-spin-demo-banner">
          ทดลองหลังร้านเท่านั้น · ยังไม่เปิดในลิงก์ลูกค้า (/claim · /join)
        </p>
        <p className="members-slim-hint muted">
          เกมเดียว: หมุนวงล้อ · กดหยุดแล้วหน่วงตามฟิสิกส์ · ได้แต้มคงที่ 1–5
          (ไม่ใช่ตัวคูณ) · ชิ้นคะแนนเดียวกันถูกแบ่งย่อยกระจายรอบวง · โลโก้จากบิล/ใบเสร็จ
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
            <span>พื้นหลังวงล้อ → หมุนเล่นรอบเดียว</span>
          </button>
          <button
            type="button"
            className={`pts-spin-demo-game-card${tab === "spin" ? " is-active" : ""}`}
            onClick={() => {
              setTab("spin");
              setLastNote(null);
            }}
          >
            <strong>ทดสอบวงล้อ</strong>
            <span>ปรับสัดส่วนชิ้นแล้วหมุนลอง</span>
          </button>
        </div>

        <div className="pts-spin-demo-weights">
          <p className="pts-spin-demo-weights-title">
            สัดส่วนมุมรวมแต่ละแต้ม (จะถูกแบ่งย่อยกระจายรอบวง)
          </p>
          {POINT_TIERS.map((m) => (
            <label key={m} className="pts-spin-demo-weight-row">
              <span className="pts-spin-demo-weight-label">{m} แต้ม</span>
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
                {formatPercent(probs[m])} · {SPIN_MENU_PRIZES[m].label}
              </span>
            </label>
          ))}
          <p className="members-slim-hint muted">
            ค่าคาดหวัง ≈ <strong>{ev.toFixed(2)}</strong> แต้ม · ค่าเริ่ม ≈{" "}
            {expectedPoints(DEFAULT_SPIN_WEIGHTS).toFixed(2)} แต้ม · ผลจริงขึ้นกับจังหวะกดหยุด +
            การหน่วง ไม่ได้สุ่มจากเปอร์เซ็นต์ล่วงหน้า
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
            รีเซ็ตสัดส่วนค่าเริ่ม
          </button>
        </div>
      </section>

      <section className="staff-hub-panel members-slim-panel">
        {tab === "customer" ? (
          <div>
            <p className="pts-spin-demo-weights-title">1) พื้นหลังตอนสมัคร/ล็อกอิน</p>
            <div className="pts-attract-demo-frame join-page join-page--attract">
              <PointsGamesAttractBg key={`bg-${gameKey}`} />
              <div className="join-card" style={{ margin: "2.5rem auto", position: "relative" }}>
                <p className="join-brand">TellTea</p>
                <h1 style={{ fontSize: "1.1rem", margin: 0 }}>สมัครสมาชิก</h1>
                <p className="muted" style={{ marginTop: "0.35rem" }}>
                  ด้านหลังมีวงล้อหมุนอยู่ · สมัครแล้วได้หมุนลุ้นแต้ม
                </p>
              </div>
            </div>
            <p className="pts-spin-demo-weights-title" style={{ marginTop: "1rem" }}>
              2) หลังเข้าสู่ระบบ — หมุนวงล้อ
            </p>
            <PointsGameOnce
              key={`once-${gameKey}`}
              allowReselect
              onFinished={({ result }) => {
                setLastNote(
                  `ได้ +${result.points} แต้ม (${SPIN_MENU_PRIZES[result.points].label})`,
                );
              }}
            />
          </div>
        ) : null}
        {tab === "spin" ? (
          <PointsMultiplierSpin
            key={gameKey}
            mode="demo"
            weights={weights}
            hint="กดเริ่ม → กดหยุด → วงหน่วงเอง · แต้มตามชิ้นใต้เข็ม"
            onComplete={(r) => {
              setLastNote(`หมุนวงล้อ · ได้ +${r.points} แต้ม`);
            }}
          />
        ) : null}
        {lastNote ? <p className="members-slim-msg">{lastNote}</p> : null}
      </section>

      <section className="staff-hub-panel members-slim-panel">
        <p className="pts-spin-demo-weights-title">
          จำลองตำแหน่งหยุด 2,000 ครั้ง (ตามสัดส่วนชิ้นบนวง)
        </p>
        <div className="pts-spin-demo-pick">
          <button
            type="button"
            className="primary-btn staff-btn-sm"
            onClick={() => setSimCount(simulateSpins(2000, weights))}
          >
            จำลองมุมสุ่ม
          </button>
          <button
            type="button"
            className="ghost-btn staff-btn-sm"
            onClick={() => setSimCount(simulatePhysicsCoasts(2000, weights))}
          >
            จำลองหน่วงฟิสิกส์
          </button>
        </div>
        {simCount ? (
          <ul className="pts-spin-demo-hist">
            {POINT_TIERS.map((m) => {
              const n = simCount[m];
              const pct = (n / 2000) * 100;
              return (
                <li key={m}>
                  <span>{m} แต้ม</span>
                  <span className="pts-spin-demo-bar">
                    <i style={{ width: `${Math.min(100, pct)}%` }} />
                  </span>
                  <span>
                    {n} ({pct.toFixed(1)}%) · เป้า {formatPercent(probs[m])}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted members-slim-hint">
            กดจำลองเพื่อเทียบกับการกระจายชิ้นบนวงล้อ
          </p>
        )}
      </section>

      <section className="staff-hub-panel members-slim-panel">
        <p className="pts-spin-demo-weights-title">กฎ</p>
        <ol className="pts-spin-demo-flow">
          <li>เกมเดียว: หมุนวงล้อ</li>
          <li>กดหยุดแล้ววงล้อหน่วงตามแรง — ไม่จับผลจากเปอร์เซ็นต์ล่วงหน้า</li>
          <li>ได้แต้มคงที่ 1–5 ตามชิ้นใต้เข็ม · ไม่คูณแต้มฐาน</li>
          <li>สัดส่วนมุมรวมปรับได้ แต่ชิ้นจะถูกแบ่งย่อยกระจายรอบวง</li>
        </ol>
        <p className="muted members-slim-hint">
          ลิงก์นี้: <code>/members/spin-demo/</code> · รายละเอียด{" "}
          <code>docs/members-points-spin.md</code>
        </p>
      </section>
    </div>
  );
}
