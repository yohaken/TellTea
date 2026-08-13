"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  DEFAULT_POINTS_SPIN_SETTINGS,
  DEFAULT_SLICE_COUNT,
  SLICE_COUNT_MAX,
  SLICE_COUNT_MIN,
  approxSliceDegrees,
  loadPointsSpinSettings,
  normalizeSpinSettings,
  savePointsSpinSettings,
  type PointsSpinSettings,
} from "@/lib/points-spin-settings";
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
  const { staff, user } = useAuth();
  const canHub = canAccessMembersHub(staff);

  const [tab, setTab] = useState<DemoTab>("customer");
  const [sliceCount, setSliceCount] = useState(DEFAULT_SLICE_COUNT);
  const [spinSpeed, setSpinSpeed] = useState(DEFAULT_POINTS_SPIN_SETTINGS.spinSpeed);
  const [stopDecel, setStopDecel] = useState(DEFAULT_POINTS_SPIN_SETTINGS.stopDecel);
  const [w1, setW1] = useState(50);
  const [w2, setW2] = useState(28);
  const [w3, setW3] = useState(14);
  const [w4, setW4] = useState(6);
  const [w5, setW5] = useState(2);
  const [simCount, setSimCount] = useState<Record<PointTier, number> | null>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    void loadPointsSpinSettings().then((s) => {
      applySettingsToForm(s);
      setLoadedAt(s.updatedAt);
    });
  }, []);

  function applySettingsToForm(s: PointsSpinSettings) {
    setSliceCount(s.sliceCount);
    setSpinSpeed(s.spinSpeed);
    setStopDecel(s.stopDecel);
    const map: Record<PointTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const w of s.weights) map[w.points] = w.weight;
    setW1(map[1] || 0);
    setW2(map[2] || 0);
    setW3(map[3] || 0);
    setW4(map[4] || 0);
    setW5(map[5] || 0);
  }

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

  const draft: PointsSpinSettings = useMemo(
    () =>
      normalizeSpinSettings({
        sliceCount,
        weights,
        spinSpeed,
        stopDecel,
        updatedAt: loadedAt,
        updatedBy: "",
      }),
    [sliceCount, weights, spinSpeed, stopDecel, loadedAt],
  );

  const probs = useMemo(() => probabilityMap(draft.weights), [draft.weights]);
  const ev = useMemo(() => expectedPoints(draft.weights), [draft.weights]);
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

  async function onSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const actor = user?.uid || staff?.id || "boh";
      const saved = await savePointsSpinSettings(
        {
          sliceCount: draft.sliceCount,
          weights: draft.weights,
          spinSpeed: draft.spinSpeed,
          stopDecel: draft.stopDecel,
        },
        actor,
      );
      applySettingsToForm(saved);
      setLoadedAt(saved.updatedAt);
      setSaveMsg("บันทึกค่าตั้งวงล้อแล้ว · ใช้กับเกมจริงเมื่อเปิดลูกค้า");
      setSimCount(null);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

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

  const gameKey = `${tab}-${draft.sliceCount}-${draft.spinSpeed}-${draft.stopDecel}-${w1}-${w2}-${w3}-${w4}-${w5}`;
  const degEach = approxSliceDegrees(draft.sliceCount);

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
          ผู้เล่นต้อง<strong>กะจังหวะกดหยุดเอง</strong> · ช่องต้องใหญ่พอเห็น ·
          จำนวนช่อง/สัดส่วน/ความเร็วตั้งได้ด้านล่างแล้วกดบันทึก
        </p>

        <p className="pts-spin-demo-weights-title">ค่าตั้งเกม (บันทึกใช้จริง)</p>

        <label className="pts-spin-demo-field">
          <span>
            จำนวนช่องบนวงล้อ ({SLICE_COUNT_MIN}–{SLICE_COUNT_MAX}) · ตอนนี้ ~{degEach}°
            ต่อช่อง
          </span>
          <input
            type="range"
            min={SLICE_COUNT_MIN}
            max={SLICE_COUNT_MAX}
            step={1}
            value={sliceCount}
            onChange={(e) => setSliceCount(Number(e.target.value))}
          />
          <input
            type="number"
            min={SLICE_COUNT_MIN}
            max={SLICE_COUNT_MAX}
            value={sliceCount}
            onChange={(e) => setSliceCount(Number(e.target.value) || DEFAULT_SLICE_COUNT)}
          />
          <span className="muted pts-spin-demo-pct">
            น้อย = ช่องใหญ่ กะง่าย · มาก = ยากขึ้น (สูงสุด {SLICE_COUNT_MAX})
          </span>
        </label>

        <label className="pts-spin-demo-field">
          <span>ความเร็วหมุน (deg/s) · ช้าลงจะกะง่ายขึ้น</span>
          <input
            type="range"
            min={160}
            max={640}
            step={10}
            value={spinSpeed}
            onChange={(e) => setSpinSpeed(Number(e.target.value))}
          />
          <input
            type="number"
            min={160}
            max={640}
            value={spinSpeed}
            onChange={(e) => setSpinSpeed(Number(e.target.value) || 320)}
          />
        </label>

        <label className="pts-spin-demo-field">
          <span>ความหน่วงตอนกดหยุด (deg/s²) · น้อย = ไหลนาน กะระยะได้</span>
          <input
            type="range"
            min={180}
            max={900}
            step={10}
            value={stopDecel}
            onChange={(e) => setStopDecel(Number(e.target.value))}
          />
          <input
            type="number"
            min={180}
            max={900}
            value={stopDecel}
            onChange={(e) => setStopDecel(Number(e.target.value) || 380)}
          />
        </label>

        <div className="pts-spin-demo-weights">
          <p className="pts-spin-demo-weights-title">
            สัดส่วนมุมรวมแต่ละแต้ม (จะถูกแบ่งย่อยกระจายรอบวงตามจำนวนช่อง)
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
            ค่าคาดหวังถ้าหยุดสุ่ม ≈ <strong>{ev.toFixed(2)}</strong> แต้ม ·
            ผลจริงขึ้นกับจังหวะกดหยุดของผู้เล่น
          </p>
          <div className="pts-spin-demo-pick">
            <button
              type="button"
              className="primary-btn staff-btn-sm"
              disabled={saving}
              onClick={() => void onSave()}
            >
              {saving ? "กำลังบันทึก…" : "บันทึกค่าตั้งวงล้อ"}
            </button>
            <button
              type="button"
              className="ghost-btn staff-btn-sm"
              onClick={() => {
                applySettingsToForm({
                  ...DEFAULT_POINTS_SPIN_SETTINGS,
                  weights: DEFAULT_SPIN_WEIGHTS.map((w) => ({ ...w })),
                });
                setSimCount(null);
                setSaveMsg(null);
              }}
            >
              รีเซ็ตค่าเริ่ม (ยังไม่บันทึก)
            </button>
          </div>
          {saveMsg ? <p className="members-slim-msg">{saveMsg}</p> : null}
          {loadedAt > 0 ? (
            <p className="muted members-slim-hint">
              บันทึกล่าสุด: {new Date(loadedAt).toLocaleString("th-TH")}
            </p>
          ) : null}
        </div>

        <p className="pts-spin-demo-weights-title" style={{ marginTop: "1rem" }}>
          โหมดดู
        </p>
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
            <span>ลองกะจังหวะด้วยค่าที่ตั้งไว้</span>
          </button>
        </div>
      </section>

      <section className="staff-hub-panel members-slim-panel">
        {tab === "customer" ? (
          <div>
            <p className="pts-spin-demo-weights-title">1) พื้นหลังตอนสมัคร/ล็อกอิน</p>
            <div className="pts-attract-demo-frame join-page join-page--attract">
              <PointsGamesAttractBg key={`bg-${gameKey}`} settings={draft} />
              <div className="join-card" style={{ margin: "2.5rem auto", position: "relative" }}>
                <p className="join-brand">TellTea</p>
                <h1 style={{ fontSize: "1.1rem", margin: 0 }}>สมัครสมาชิก</h1>
                <p className="muted" style={{ marginTop: "0.35rem" }}>
                  ด้านหลังมีวงล้อหมุนอยู่ · สมัครแล้วหมุนลุ้นแต้มด้วยจังหวะตัวเอง
                </p>
              </div>
            </div>
            <p className="pts-spin-demo-weights-title" style={{ marginTop: "1rem" }}>
              2) หลังเข้าสู่ระบบ — หมุนวงล้อ
            </p>
            <PointsGameOnce
              key={`once-${gameKey}`}
              settings={draft}
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
            weights={draft.weights}
            sliceCount={draft.sliceCount}
            spinSpeed={draft.spinSpeed}
            stopDecel={draft.stopDecel}
            hint="มองช่องที่อยากได้ → กดหยุด → วงหน่วงเองตามแรง"
            onComplete={(r) => {
              setLastNote(`หมุนวงล้อ · ได้ +${r.points} แต้ม`);
            }}
          />
        ) : null}
        {lastNote ? <p className="members-slim-msg">{lastNote}</p> : null}
      </section>

      <section className="staff-hub-panel members-slim-panel">
        <p className="pts-spin-demo-weights-title">
          จำลองตำแหน่งหยุด 2,000 ครั้ง (เทียบสัดส่วนชิ้น — ไม่ใช่ผลบังคับในเกมจริง)
        </p>
        <div className="pts-spin-demo-pick">
          <button
            type="button"
            className="primary-btn staff-btn-sm"
            onClick={() =>
              setSimCount(simulateSpins(2000, draft.weights, Math.random, draft.sliceCount))
            }
          >
            จำลองมุมสุ่ม
          </button>
          <button
            type="button"
            className="ghost-btn staff-btn-sm"
            onClick={() =>
              setSimCount(
                simulatePhysicsCoasts(
                  2000,
                  draft.weights,
                  Math.random,
                  draft.sliceCount,
                  draft.spinSpeed,
                  draft.stopDecel,
                ),
              )
            }
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
            ในเกมจริงผู้เล่นกะจังหวะเอง — ตัวเลขนี้แค่เทียบสัดส่วนชิ้นบนวง
          </p>
        )}
      </section>

      <section className="staff-hub-panel members-slim-panel">
        <p className="pts-spin-demo-weights-title">กฎ</p>
        <ol className="pts-spin-demo-flow">
          <li>เกมเดียว: หมุนวงล้อ · ใช้ความสามารถกะจังหวะกดหยุด</li>
          <li>จำนวนช่องตั้งได้ (ค่าเริ่ม {DEFAULT_SLICE_COUNT}) — ช่องใหญ่พอให้คาดเดา</li>
          <li>กดหยุดแล้ววงหน่วงตามแรง — ไม่จับผลจากเปอร์เซ็นต์ล่วงหน้า</li>
          <li>ได้แต้มคงที่ 1–5 ตามชิ้นใต้เข็ม</li>
        </ol>
      </section>
    </div>
  );
}
