"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PAYROLL_SCHEDULE,
  savePayrollSchedule,
  type PayrollSchedule,
  type PayrollSalarySplit,
} from "@/lib/payroll";

export function PayrollSettingsPanel({
  schedule,
  isOwner,
  onError,
  onInfo,
}: {
  schedule: PayrollSchedule;
  isOwner: boolean;
  onError: (msg: string) => void;
  onInfo?: (msg: string) => void;
}) {
  const [midDay, setMidDay] = useState(String(schedule.salarySplits[0]?.dayOfMonth ?? 15));
  const [midPct, setMidPct] = useState(String(schedule.salarySplits[0]?.percent ?? 50));
  const [endDay, setEndDay] = useState(String(schedule.salarySplits[1]?.dayOfMonth ?? 1));
  const [endPct, setEndPct] = useState(String(schedule.salarySplits[1]?.percent ?? 50));
  const [bonusDay, setBonusDay] = useState(String(schedule.bonusDayOfMonth));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMidDay(String(schedule.salarySplits[0]?.dayOfMonth ?? 15));
    setMidPct(String(schedule.salarySplits[0]?.percent ?? 50));
    setEndDay(String(schedule.salarySplits[1]?.dayOfMonth ?? 1));
    setEndPct(String(schedule.salarySplits[1]?.percent ?? 50));
    setBonusDay(String(schedule.bonusDayOfMonth));
  }, [schedule]);

  async function onSave() {
    if (!isOwner) return;
    setBusy(true);
    try {
      const salarySplits: PayrollSalarySplit[] = [
        {
          id: "mid",
          kind: "salary_mid",
          dayOfMonth: Number(midDay),
          percent: Number(midPct),
          forPreviousMonth: false,
        },
        {
          id: "end",
          kind: "salary_month_end",
          dayOfMonth: Number(endDay),
          percent: Number(endPct),
          forPreviousMonth: true,
        },
      ];
      await savePayrollSchedule({
        salarySplits,
        bonusDayOfMonth: Number(bonusDay),
        bonusWithSalaryEnd: true,
        bonusForPreviousMonth: true,
      });
      onInfo?.("บันทึกตารางจ่ายแล้ว");
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    if (!isOwner) return;
    setBusy(true);
    try {
      await savePayrollSchedule({ ...DEFAULT_PAYROLL_SCHEDULE });
      onInfo?.("รีเซ็ตเป็นค่าเริ่มต้นแล้ว (15/1 · 50/50)");
    } catch (err) {
      onError((err as Error).message || "รีเซ็ตไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) {
    return (
      <p className="muted">
        ตารางจ่าย: กลางเดือนวันที่ {schedule.salarySplits[0]?.dayOfMonth ?? 15} (
        {schedule.salarySplits[0]?.percent ?? 50}%) · ปลายเดือนวันที่{" "}
        {schedule.salarySplits[1]?.dayOfMonth ?? 1} ({schedule.salarySplits[1]?.percent ?? 50}%
        ของเดือนที่แล้ว) · โบนัสวันที่ {schedule.bonusDayOfMonth}
      </p>
    );
  }

  return (
    <section className="payroll-settings">
      <h2 className="panel-title" style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>
        ตารางจ่ายเงินเดือน / โบนัส
      </h2>
      <p className="muted payroll-settings-hint">
        ค่าเริ่มต้น: วันที่ 15 = 50% · วันที่ 1 = 50% ของเดือนที่แล้ว + โบนัสเดือนที่แล้ว
      </p>
      <div className="payroll-settings-grid">
        <label className="field">
          <span>วันงวดกลาง</span>
          <input
            type="number"
            min={1}
            max={28}
            value={midDay}
            onChange={(e) => setMidDay(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>% งวดกลาง</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={midPct}
            onChange={(e) => setMidPct(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>วันงวดปลาย</span>
          <input
            type="number"
            min={1}
            max={28}
            value={endDay}
            onChange={(e) => setEndDay(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>% งวดปลาย</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={endPct}
            onChange={(e) => setEndPct(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>วันจ่ายโบนัส</span>
          <input
            type="number"
            min={1}
            max={28}
            value={bonusDay}
            onChange={(e) => setBonusDay(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <p className="muted form-hint-inline">
        งวดปลาย + โบนัส อ้างอิงเดือนที่แล้วเสมอ (เคลียรยอดวันที่จ่าย)
      </p>
      <div className="module-form-actions" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="ghost-btn" disabled={busy} onClick={() => void onReset()}>
          ค่าเริ่มต้น
        </button>
        <button type="button" className="primary-btn" disabled={busy} onClick={() => void onSave()}>
          {busy ? "..." : "บันทึกตาราง"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: "1rem" }}>
        เงินเดือนรายคนตั้งที่{" "}
        <a href="/staff/" style={{ fontWeight: 700 }}>
          ศูนย์รวมพนักงาน
        </a>
      </p>
    </section>
  );
}
