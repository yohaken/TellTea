"use client";

import { useEffect, useMemo, useState } from "react";
import { listActiveEmployees, updateEmployee, type Employee } from "@/lib/employees";
import {
  DEFAULT_PAYROLL_SCHEDULE,
  salaryAmountForSplit,
  savePayrollSchedule,
  type PayrollSchedule,
  type PayrollSalarySplit,
} from "@/lib/payroll";
import { formatPlainNumber } from "@/lib/utils";

function fmt(n: number) {
  return formatPlainNumber(n);
}

type DraftSalary = {
  monthlySalary: string;
  payBank: string;
  payAccountNo: string;
  payAccountName: string;
};

function draftFromEmployee(emp: Employee): DraftSalary {
  return {
    monthlySalary:
      emp.monthlySalary != null && emp.monthlySalary > 0 ? String(emp.monthlySalary) : "",
    payBank: emp.payBank || "",
    payAccountNo: emp.payAccountNo || "",
    payAccountName: emp.payAccountName || "",
  };
}

export function PayrollSettingsPanel({
  schedule,
  employees,
  isOwner,
  onError,
  onInfo,
  onEmployeesChange,
}: {
  schedule: PayrollSchedule;
  employees: Employee[];
  isOwner: boolean;
  onError: (msg: string) => void;
  onInfo?: (msg: string) => void;
  onEmployeesChange?: (emps: Employee[]) => void;
}) {
  const mid = schedule.salarySplits[0] ?? DEFAULT_PAYROLL_SCHEDULE.salarySplits[0];
  const end = schedule.salarySplits[1] ?? DEFAULT_PAYROLL_SCHEDULE.salarySplits[1];

  const [midDay, setMidDay] = useState(String(mid.dayOfMonth));
  const [endDay, setEndDay] = useState(String(end.dayOfMonth));
  const [midPct, setMidPct] = useState(String(mid.percent));
  const [endPct, setEndPct] = useState(String(end.percent));
  const [busySchedule, setBusySchedule] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, DraftSalary>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setMidDay(String(schedule.salarySplits[0]?.dayOfMonth ?? 15));
    setEndDay(String(schedule.salarySplits[1]?.dayOfMonth ?? 1));
    setMidPct(String(schedule.salarySplits[0]?.percent ?? 50));
    setEndPct(String(schedule.salarySplits[1]?.percent ?? 50));
  }, [schedule]);

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, DraftSalary> = {};
      for (const emp of employees) {
        next[emp.id] = prev[emp.id] ?? draftFromEmployee(emp);
      }
      return next;
    });
  }, [employees]);

  const roster = useMemo(
    () => [...employees].filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name, "th")),
    [employees],
  );

  const missingSalary = roster.filter((e) => !(Number(e.monthlySalary) > 0)).length;
  const midPctN = Number(midPct) || 0;
  const endPctN = Number(endPct) || 0;

  async function onSaveSchedule() {
    if (!isOwner) return;
    setBusySchedule(true);
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
        bonusDayOfMonth: Number(endDay),
        bonusWithSalaryEnd: true,
        bonusForPreviousMonth: true,
      });
      onInfo?.(`บันทึกแล้ว · จ่ายวันที่ ${Number(midDay)} และวันที่ ${Number(endDay)}`);
    } catch (err) {
      onError((err as Error).message || "บันทึกตารางไม่สำเร็จ");
    } finally {
      setBusySchedule(false);
    }
  }

  async function onResetSchedule() {
    if (!isOwner) return;
    setBusySchedule(true);
    try {
      await savePayrollSchedule({ ...DEFAULT_PAYROLL_SCHEDULE });
      onInfo?.("รีเซ็ตเป็น วันที่ 15 + วันที่ 1 · อย่างละ 50%");
    } catch (err) {
      onError((err as Error).message || "รีเซ็ตไม่สำเร็จ");
    } finally {
      setBusySchedule(false);
    }
  }

  function patchDraft(id: string, patch: Partial<DraftSalary>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || draftFromEmployee(roster.find((e) => e.id === id)!)), ...patch },
    }));
  }

  async function onSaveEmployee(emp: Employee) {
    if (!isOwner) return;
    const draft = drafts[emp.id] || draftFromEmployee(emp);
    const raw = draft.monthlySalary.trim();
    const salaryNum = raw === "" ? 0 : Number(raw);
    if (raw !== "" && (!Number.isFinite(salaryNum) || salaryNum < 0)) {
      onError(`เงินเดือนของ ${emp.name} ไม่ถูกต้อง`);
      return;
    }
    setSavingId(emp.id);
    try {
      await updateEmployee(emp.id, {
        monthlySalary: salaryNum,
        payBank: draft.payBank.trim(),
        payAccountNo: draft.payAccountNo.trim(),
        payAccountName: draft.payAccountName.trim(),
      });
      const refreshed = await listActiveEmployees();
      onEmployeesChange?.(refreshed);
      onInfo?.(`บันทึกเงินเดือน · ${emp.name}`);
      setExpandedId(null);
    } catch (err) {
      onError((err as Error).message || "บันทึกเงินเดือนไม่สำเร็จ");
    } finally {
      setSavingId(null);
    }
  }

  if (!isOwner) {
    return (
      <section className="payroll-settings">
        <p className="muted">
          จ่าย 2 รอบ: วันที่ {mid.dayOfMonth} ({mid.percent}%) · วันที่ {end.dayOfMonth} (
          {end.percent}% + โบนัสเดือนที่แล้ว)
        </p>
        <ul className="payroll-salary-readonly">
          {roster.map((emp) => (
            <li key={emp.id}>
              <strong>{emp.name}</strong>
              <span className="muted">
                {emp.monthlySalary && emp.monthlySalary > 0
                  ? `฿${fmt(emp.monthlySalary)} / เดือน`
                  : "ยังไม่ตั้งเงินเดือน"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="payroll-settings">
      <div className="payroll-settings-block">
        <h2 className="payroll-settings-title">1) รอบจ่ายเงินเดือน</h2>
        <p className="muted payroll-settings-hint">
          จ่ายเดือนละ 2 ครั้ง · งวดหลังรวมโบนัสเดือนที่แล้ว · ค่าเริ่มต้น วันที่ 15 และวันที่ 1
          อย่างละ 50%
        </p>

        <div className="payroll-round-cards">
          <div className="payroll-round-card">
            <span className="payroll-round-label">รอบที่ 1 · กลางเดือน</span>
            <label className="field">
              <span>วันที่</span>
              <input
                type="number"
                min={1}
                max={28}
                value={midDay}
                onChange={(e) => setMidDay(e.target.value)}
                disabled={busySchedule}
              />
            </label>
            <label className="field">
              <span>สัดส่วน %</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={midPct}
                onChange={(e) => setMidPct(e.target.value)}
                disabled={busySchedule}
              />
            </label>
            <p className="muted payroll-round-note">จ่ายของเดือนปัจจุบัน</p>
          </div>

          <div className="payroll-round-card">
            <span className="payroll-round-label">รอบที่ 2 · ต้นเดือนถัดไป</span>
            <label className="field">
              <span>วันที่</span>
              <input
                type="number"
                min={1}
                max={28}
                value={endDay}
                onChange={(e) => setEndDay(e.target.value)}
                disabled={busySchedule}
              />
            </label>
            <label className="field">
              <span>สัดส่วน %</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={endPct}
                onChange={(e) => setEndPct(e.target.value)}
                disabled={busySchedule}
              />
            </label>
            <p className="muted payroll-round-note">
              เคลียรเงินเดือนที่เหลือ + โบนัสของเดือนที่แล้ว
            </p>
          </div>
        </div>

        <div className="module-form-actions" style={{ marginTop: "0.65rem" }}>
          <button
            type="button"
            className="ghost-btn"
            disabled={busySchedule}
            onClick={() => void onResetSchedule()}
          >
            ค่าเริ่มต้น 15 / 1
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busySchedule}
            onClick={() => void onSaveSchedule()}
          >
            {busySchedule ? "..." : "บันทึกรอบจ่าย"}
          </button>
        </div>
      </div>

      <div className="payroll-settings-block">
        <h2 className="payroll-settings-title">2) เงินเดือนพนักงาน</h2>
        <p className="muted payroll-settings-hint">
          ใส่ยอดต่อเดือนที่นี่ · ระบบจะแบ่งตามรอบด้านบนอัตโนมัติ
          {missingSalary ? ` · ยังไม่ตั้ง ${missingSalary} คน` : ""}
        </p>

        {!roster.length ? (
          <p className="empty">ยังไม่มีพนักงานใช้งาน — เพิ่มชื่อที่ศูนย์พนักงานก่อน</p>
        ) : (
          <ul className="payroll-salary-list">
            {roster.map((emp) => {
              const draft = drafts[emp.id] || draftFromEmployee(emp);
              const salaryNum = Number(draft.monthlySalary) || 0;
              const midAmt = salaryAmountForSplit(salaryNum, midPctN);
              const endAmt = salaryAmountForSplit(salaryNum, endPctN);
              const open = expandedId === emp.id;
              const busy = savingId === emp.id;
              return (
                <li key={emp.id} className="payroll-salary-row">
                  <div className="payroll-salary-row-head">
                    <div>
                      <strong>{emp.name}</strong>
                      <div className="muted payroll-salary-meta">
                        {salaryNum > 0
                          ? `฿${fmt(salaryNum)} / เดือน · รอบ1 ฿${fmt(midAmt)} · รอบ2 ฿${fmt(endAmt)}`
                          : "ยังไม่ตั้งเงินเดือน"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={!!savingId}
                      onClick={() => setExpandedId(open ? null : emp.id)}
                    >
                      {open ? "ปิด" : "ตั้งค่า"}
                    </button>
                  </div>

                  {open ? (
                    <div className="payroll-salary-edit">
                      <label className="field">
                        <span>เงินเดือน / เดือน (บาท)</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          inputMode="decimal"
                          value={draft.monthlySalary}
                          onChange={(e) => patchDraft(emp.id, { monthlySalary: e.target.value })}
                          disabled={busy}
                          placeholder="เช่น 15000"
                          autoFocus
                        />
                      </label>
                      <label className="field">
                        <span>ธนาคาร (ถ้ามี)</span>
                        <input
                          value={draft.payBank}
                          onChange={(e) => patchDraft(emp.id, { payBank: e.target.value })}
                          disabled={busy}
                          placeholder="optional"
                        />
                      </label>
                      <label className="field">
                        <span>เลขบัญชี</span>
                        <input
                          value={draft.payAccountNo}
                          onChange={(e) => patchDraft(emp.id, { payAccountNo: e.target.value })}
                          disabled={busy}
                          placeholder="optional"
                        />
                      </label>
                      <label className="field">
                        <span>ชื่อบัญชี</span>
                        <input
                          value={draft.payAccountName}
                          onChange={(e) => patchDraft(emp.id, { payAccountName: e.target.value })}
                          disabled={busy}
                          placeholder="optional"
                        />
                      </label>
                      {salaryNum > 0 ? (
                        <p className="muted form-hint-inline">
                          ตัวอย่างจ่าย: วันที่ {midDay} = ฿{fmt(midAmt)} · วันที่ {endDay} = ฿
                          {fmt(endAmt)} (+ โบนัส)
                        </p>
                      ) : null}
                      <div className="module-form-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={busy}
                          onClick={() => {
                            setDrafts((prev) => ({ ...prev, [emp.id]: draftFromEmployee(emp) }));
                            setExpandedId(null);
                          }}
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={busy}
                          onClick={() => void onSaveEmployee(emp)}
                        >
                          {busy ? "..." : "บันทึก"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="muted payroll-settings-foot">
        ตั้งเสร็จแล้วไปแท็บ <strong>รอโอน</strong> กดสร้างรายการ — ระบบจะเตรียมคิวให้โอนตามรอบ
      </p>
    </section>
  );
}
