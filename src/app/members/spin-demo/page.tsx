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
  type SliceSizingMode,
  type SpinWeight,
} from "@/lib/points-multiplier-spin";
import {
  DEFAULT_POINTS_SPIN_SETTINGS,
  DEFAULT_SLICE_COUNT,
  DEFAULT_SLICE_COUNT_MAX,
  DEFAULT_SLICE_COUNT_MIN,
  DEFAULT_SPIN_SPEED_MAX,
  DEFAULT_SPIN_SPEED_MIN,
  DEFAULT_STOP_DECEL_MAX,
  DEFAULT_STOP_DECEL_MIN,
  SLICE_COUNT_MAX,
  SLICE_COUNT_MIN,
  approxSliceDegrees,
  loadPointsSpinSettings,
  normalizeSpinSettings,
  resolvePlaySettings,
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
  const [sliceCountMin, setSliceCountMin] = useState(DEFAULT_SLICE_COUNT_MIN);
  const [sliceCountMax, setSliceCountMax] = useState(DEFAULT_SLICE_COUNT_MAX);
  const [spinSpeedMin, setSpinSpeedMin] = useState(DEFAULT_SPIN_SPEED_MIN);
  const [spinSpeedMax, setSpinSpeedMax] = useState(DEFAULT_SPIN_SPEED_MAX);
  const [stopDecelMin, setStopDecelMin] = useState(DEFAULT_STOP_DECEL_MIN);
  const [stopDecelMax, setStopDecelMax] = useState(DEFAULT_STOP_DECEL_MAX);
  const [shuffleLayout, setShuffleLayout] = useState(true);
  const [sliceSizing, setSliceSizing] = useState<SliceSizingMode>("byWeight");
  const [spinEnabled, setSpinEnabled] = useState(false);
  const [w0, setW0] = useState(50);
  const [w1, setW1] = useState(25);
  const [w2, setW2] = useState(12);
  const [w3, setW3] = useState(7);
  const [w4, setW4] = useState(4);
  const [w5, setW5] = useState(2);
  const [simCount, setSimCount] = useState<Record<PointTier, number> | null>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [preview, setPreview] = useState<PointsSpinSettings | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    void loadPointsSpinSettings().then((s) => {
      applySettingsToForm(s);
      setLoadedAt(s.updatedAt);
    });
  }, []);

  function applySettingsToForm(s: PointsSpinSettings) {
    setSliceCountMin(s.sliceCountMin);
    setSliceCountMax(s.sliceCountMax);
    setSpinSpeedMin(s.spinSpeedMin);
    setSpinSpeedMax(s.spinSpeedMax);
    setStopDecelMin(s.stopDecelMin);
    setStopDecelMax(s.stopDecelMax);
    setShuffleLayout(s.shuffleLayout !== false);
    setSliceSizing(s.sliceSizing === "equal" ? "equal" : "byWeight");
    setSpinEnabled(s.gamesEnabled?.spin === true);
    const map: Record<PointTier, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const w of s.weights) map[w.points] = w.weight;
    setW0(map[0] || 0);
    setW1(map[1] || 0);
    setW2(map[2] || 0);
    setW3(map[3] || 0);
    setW4(map[4] || 0);
    setW5(map[5] || 0);
  }

  const weights: SpinWeight[] = useMemo(
    () => [
      { points: 0, weight: w0 },
      { points: 1, weight: w1 },
      { points: 2, weight: w2 },
      { points: 3, weight: w3 },
      { points: 4, weight: w4 },
      { points: 5, weight: w5 },
    ],
    [w0, w1, w2, w3, w4, w5],
  );

  const draft: PointsSpinSettings = useMemo(
    () =>
      normalizeSpinSettings({
        sliceCountMin,
        sliceCountMax,
        weights,
        spinSpeedMin,
        spinSpeedMax,
        stopDecelMin,
        stopDecelMax,
        shuffleLayout,
        sliceSizing,
        gamesEnabled: { spin: spinEnabled },
        updatedAt: loadedAt,
        updatedBy: "",
      }),
    [
      sliceCountMin,
      sliceCountMax,
      weights,
      spinSpeedMin,
      spinSpeedMax,
      stopDecelMin,
      stopDecelMax,
      shuffleLayout,
      sliceSizing,
      spinEnabled,
      loadedAt,
    ],
  );

  useEffect(() => {
    setPreview(resolvePlaySettings(draft));
    setPreviewKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reroll when draft ranges/weights change
  }, [draft]);

  const probs = useMemo(() => probabilityMap(draft.weights), [draft.weights]);
  const ev = useMemo(() => expectedPoints(draft.weights), [draft.weights]);
  const setters: Record<PointTier, (n: number) => void> = {
    0: setW0,
    1: setW1,
    2: setW2,
    3: setW3,
    4: setW4,
    5: setW5,
  };
  const values: Record<PointTier, number> = {
    0: w0,
    1: w1,
    2: w2,
    3: w3,
    4: w4,
    5: w5,
  };

  function rerollPreview() {
    setPreview(resolvePlaySettings(draft));
    setPreviewKey((k) => k + 1);
    setSimCount(null);
  }

  async function onSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const actor = user?.uid || staff?.id || "boh";
      const saved = await savePointsSpinSettings(
        {
          sliceCountMin: draft.sliceCountMin,
          sliceCountMax: draft.sliceCountMax,
          sliceCount: draft.sliceCount,
          weights: draft.weights,
          spinSpeedMin: draft.spinSpeedMin,
          spinSpeedMax: draft.spinSpeedMax,
          spinSpeed: draft.spinSpeed,
          stopDecelMin: draft.stopDecelMin,
          stopDecelMax: draft.stopDecelMax,
          stopDecel: draft.stopDecel,
          shuffleLayout: draft.shuffleLayout,
          sliceSizing: draft.sliceSizing,
          gamesEnabled: { spin: spinEnabled },
        },
        actor,
      );
      applySettingsToForm(saved);
      setLoadedAt(saved.updatedAt);
      setSaveMsg(
        saved.gamesEnabled.spin
          ? "บันทึกแล้ว · เกมเปิดบน /claim · /join ทันที · แต่ละรอบสุ่มในช่วงที่ตั้ง"
          : "บันทึกแล้ว · เกมยังปิดฝั่งลูกค้า (เปิดสวิตช์ด้านบนแล้วบันทึกอีกครั้ง)",
      );
      setSimCount(null);
      rerollPreview();
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

  const play = preview || draft;
  const gameKey = `${tab}-${previewKey}-${play.sliceCount}-${play.spinSpeed}-${play.stopDecel}-${play.layoutSeed}-${play.sliceSizing}-${w0}-${w1}-${w2}-${w3}-${w4}-${w5}`;
  const degEach = approxSliceDegrees(play.sliceCount);

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
        <p className={`pts-spin-demo-banner${spinEnabled ? " is-live" : ""}`}>
          {spinEnabled
            ? "เกมเปิดฝั่งลูกค้าแล้ว · แต่ละรอบสุ่มในช่วงที่บันทึก · มีผลบน /claim · /join"
            : "เกมยังปิดฝั่งลูกค้า · ทดลองหลังร้านได้ตามปกติ"}
        </p>
        <p className="members-slim-hint muted">
          ผู้เล่นต้อง<strong>กะจังหวะกดหยุดเอง</strong> · แต่ละรอบสุ่มจำนวนช่อง /
          ความเร็ว / ความหน่วง / ตำแหน่ง · กันจับทาง
        </p>

        <label className="pts-spin-demo-live-toggle">
          <input
            type="checkbox"
            checked={spinEnabled}
            onChange={(e) => setSpinEnabled(e.target.checked)}
          />
          <span>
            <strong>เปิดเกม «หมุนวงล้อ»</strong> บนลิงก์สมาชิก (/claim · /join)
            <span className="muted"> — ปิด/เปิดรายเกม · กดบันทึกด้านล่างเพื่อมีผลทันที</span>
          </span>
        </label>

        <p className="pts-spin-demo-weights-title">ค่าตั้งเกม (บันทึกใช้จริง)</p>

        <label className="pts-spin-demo-field">
          <span>
            สุ่มจำนวนช่อง ({SLICE_COUNT_MIN}–{SLICE_COUNT_MAX}) · ค่าเริ่ม{" "}
            {DEFAULT_SLICE_COUNT_MIN}–{DEFAULT_SLICE_COUNT_MAX}
          </span>
          <div className="pts-spin-demo-range-row">
            <span className="muted">ต่ำ</span>
            <input
              type="number"
              min={SLICE_COUNT_MIN}
              max={SLICE_COUNT_MAX}
              value={sliceCountMin}
              onChange={(e) =>
                setSliceCountMin(Number(e.target.value) || DEFAULT_SLICE_COUNT_MIN)
              }
            />
            <span className="muted">สูง</span>
            <input
              type="number"
              min={SLICE_COUNT_MIN}
              max={SLICE_COUNT_MAX}
              value={sliceCountMax}
              onChange={(e) =>
                setSliceCountMax(Number(e.target.value) || DEFAULT_SLICE_COUNT_MAX)
              }
            />
          </div>
          <span className="muted pts-spin-demo-pct">
            รอบตัวอย่างตอนนี้ {play.sliceCount} ช่อง
            {sliceSizing === "equal" ? ` (~${degEach}° เท่ากัน)` : " · ขนาดตาม %"}
          </span>
        </label>

        <label className="pts-spin-demo-field">
          <span>
            สุ่มความเร็วหมุน (deg/s) · ค่าเริ่ม {DEFAULT_SPIN_SPEED_MIN}–
            {DEFAULT_SPIN_SPEED_MAX}
          </span>
          <div className="pts-spin-demo-range-row">
            <span className="muted">ต่ำ</span>
            <input
              type="number"
              min={160}
              max={640}
              value={spinSpeedMin}
              onChange={(e) =>
                setSpinSpeedMin(Number(e.target.value) || DEFAULT_SPIN_SPEED_MIN)
              }
            />
            <span className="muted">สูง</span>
            <input
              type="number"
              min={160}
              max={640}
              value={spinSpeedMax}
              onChange={(e) =>
                setSpinSpeedMax(Number(e.target.value) || DEFAULT_SPIN_SPEED_MAX)
              }
            />
          </div>
          <span className="muted pts-spin-demo-pct">
            รอบตัวอย่าง · {play.spinSpeed} deg/s
          </span>
        </label>

        <label className="pts-spin-demo-field">
          <span>
            สุ่มความหน่วงตอนกดหยุด (deg/s²) · ค่าเริ่ม {DEFAULT_STOP_DECEL_MIN}–
            {DEFAULT_STOP_DECEL_MAX}
          </span>
          <div className="pts-spin-demo-range-row">
            <span className="muted">ต่ำ</span>
            <input
              type="number"
              min={180}
              max={900}
              value={stopDecelMin}
              onChange={(e) =>
                setStopDecelMin(Number(e.target.value) || DEFAULT_STOP_DECEL_MIN)
              }
            />
            <span className="muted">สูง</span>
            <input
              type="number"
              min={180}
              max={900}
              value={stopDecelMax}
              onChange={(e) =>
                setStopDecelMax(Number(e.target.value) || DEFAULT_STOP_DECEL_MAX)
              }
            />
          </div>
          <span className="muted pts-spin-demo-pct">
            รอบตัวอย่าง · {play.stopDecel} deg/s² · น้อย = ไหลนาน
          </span>
        </label>

        <label className="pts-spin-demo-live-toggle">
          <input
            type="checkbox"
            checked={shuffleLayout}
            onChange={(e) => setShuffleLayout(e.target.checked)}
          />
          <span>
            <strong>สลับตำแหน่งชิ้นอัตโนมัติ</strong> ทุกครั้งที่เริ่มเล่น
            <span className="muted"> — ยังกระจายไม่ให้แผงเดียวกันติดยาว</span>
          </span>
        </label>

        <label className="pts-spin-demo-live-toggle">
          <input
            type="checkbox"
            checked={sliceSizing === "byWeight"}
            onChange={(e) =>
              setSliceSizing(e.target.checked ? "byWeight" : "equal")
            }
          />
          <span>
            <strong>ขนาดช่องตามสัดส่วน %</strong>
            <span className="muted">
              {" "}
              — +0 ที่ % สูงได้ช่องใหญ่ · ปิดแล้วช่องเท่ากันทุกชิ้น
            </span>
          </span>
        </label>

        <div className="pts-spin-demo-pick" style={{ marginBottom: "0.75rem" }}>
          <button
            type="button"
            className="ghost-btn staff-btn-sm"
            onClick={() => rerollPreview()}
          >
            สุ่มตัวอย่างรอบนี้ใหม่
          </button>
          <span className="muted pts-spin-demo-pct">
            {play.sliceCount} ช่อง · {play.spinSpeed}°/s · หน่วง {play.stopDecel}
            {shuffleLayout ? " · สลับตำแหน่ง" : ""}
            {sliceSizing === "byWeight" ? " · ตาม %" : " · ช่องเท่ากัน"}
          </span>
        </div>

        <div className="pts-spin-demo-weights">
          <p className="pts-spin-demo-weights-title">
            สัดส่วนมุมรวม「แต้มได้เพิ่ม」0–5 (+0 = ไม่ได้เพิ่มจากเกม · ควรหนาที่สุด)
            <span className="muted"> — ไม่สุ่ม · ตั้งเอง</span>
          </p>
          {POINT_TIERS.map((m) => (
            <label key={m} className="pts-spin-demo-weight-row">
              <span className="pts-spin-demo-weight-label">
                {m === 0 ? "+0 · ไม่เพิ่ม" : `+${m} แต้มเพิ่ม`}
              </span>
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
            <span>ลองกะจังหวะด้วยค่าที่สุ่มตัวอย่าง</span>
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
                  ด้านหลังมีวงล้อหมุนอยู่ · สมัครแล้วหมุนลุ้นแต้มได้เพิ่ม
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
                  result.points === 0
                    ? `+0 · ไม่ได้แต้มเพิ่มจากเกม`
                    : `ได้เพิ่ม +${result.points} แต้ม (${SPIN_MENU_PRIZES[result.points].label})`,
                );
              }}
            />
          </div>
        ) : null}
        {tab === "spin" ? (
          <PointsMultiplierSpin
            key={gameKey}
            mode="demo"
            weights={play.weights}
            sliceCount={play.sliceCount}
            spinSpeed={play.spinSpeed}
            stopDecel={play.stopDecel}
            sliceSizing={play.sliceSizing}
            layoutSeed={play.layoutSeed}
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
              setSimCount(
                simulateSpins(2000, play.weights, Math.random, play.sliceCount, {
                  sliceSizing: play.sliceSizing,
                  layoutSeed: play.layoutSeed,
                }),
              )
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
                  play.weights,
                  Math.random,
                  play.sliceCount,
                  play.spinSpeed,
                  play.stopDecel,
                  {
                    sliceSizing: play.sliceSizing,
                    layoutSeed: play.layoutSeed,
                  },
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
          <li>
            แต่ละรอบสุ่มจำนวนช่อง (ค่าเริ่ม {DEFAULT_SLICE_COUNT_MIN}–
            {DEFAULT_SLICE_COUNT_MAX} · mid ≈ {DEFAULT_SLICE_COUNT}) · ความเร็ว ·
            ความหน่วง
          </li>
          <li>ขนาดช่องตาม % ได้ — +0 ที่หนาจะกว้างกว่าช่องหายาก</li>
          <li>กดหยุดแล้ววงหน่วงตามแรง — ไม่จับผลจากเปอร์เซ็นต์ล่วงหน้า</li>
          <li>ลุ้นแต้มได้เพิ่ม 0–5 ตามชิ้นใต้เข็ม (+0 = ไม่ได้เพิ่มจากเกม)</li>
          <li>ชิ้นบนวงคละ / สลับตำแหน่งได้ — ไม่เรียงเลขติดกัน (เช่น 3-4-5)</li>
        </ol>
      </section>
    </div>
  );
}
