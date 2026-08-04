"use client";

import { useEffect, useMemo, useState } from "react";
import { listActiveEmployeesWithPay, updateEmployee, type Employee } from "@/lib/employees";
import {
  DEFAULT_PAYROLL_SCHEDULE,
  salaryAmountForSplit,
  savePayrollSchedule,
  type PayrollSchedule,
  type PayrollSalarySplit,
} from "@/lib/payroll";
import {
  DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS,
  getPayrollPaymentDocSettings,
  savePayrollPaymentDocSettings,
} from "@/lib/payroll-payment-doc-settings";
import { formatPlainNumber } from "@/lib/utils";

function fmt(n: number) {
  return formatPlainNumber(n);
}

type DraftSalary = {
  monthlySalary: string;
  payBank: string;
  payAccountNo: string;
  payAccountName: string;
  advanceBalance: string;
  skipGroupPayroll: boolean;
};

function draftFromEmployee(emp: Employee): DraftSalary {
  return {
    monthlySalary:
      emp.monthlySalary != null && emp.monthlySalary > 0 ? String(emp.monthlySalary) : "",
    payBank: emp.payBank || "",
    payAccountNo: emp.payAccountNo || "",
    payAccountName: emp.payAccountName || "",
    advanceBalance:
      emp.advanceBalance != null && emp.advanceBalance > 0 ? String(emp.advanceBalance) : "",
    skipGroupPayroll: Boolean(emp.skipGroupPayroll),
  };
}

export function PayrollSettingsPanel({
  schedule,
  employees,
  isOwner,
  /** เมื่อไม่ใช่เจ้าของ — แสดงเฉพาะพนักงานคนนี้ (ไม่โชวยอดคนอื่น) */
  selfEmployeeId = null,
  onError,
  onInfo,
  onEmployeesChange,
}: {
  schedule: PayrollSchedule;
  employees: Employee[];
  isOwner: boolean;
  selfEmployeeId?: string | null;
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
  const [payerName, setPayerName] = useState(
    DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS.payerName,
  );
  const [payerTitle, setPayerTitle] = useState(
    DEFAULT_PAYROLL_PAYMENT_DOC_SETTINGS.payerTitle,
  );
  const [busyDocSettings, setBusyDocSettings] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    void getPayrollPaymentDocSettings()
      .then((s) => {
        if (!alive) return;
        setPayerName(s.payerName);
        setPayerTitle(s.payerTitle);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isOwner]);

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
  const withAdvance = roster.filter((e) => Number(e.advanceBalance) > 0).length;
  const skipGroupCount = roster.filter((e) => e.skipGroupPayroll).length;
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
    const advRaw = draft.advanceBalance.trim();
    const advNum = advRaw === "" ? 0 : Number(advRaw);
    if (advRaw !== "" && (!Number.isFinite(advNum) || advNum < 0)) {
      onError(`ยอดเบิกค้างของ ${emp.name} ไม่ถูกต้อง`);
      return;
    }
    setSavingId(emp.id);
    try {
      await updateEmployee(emp.id, {
        monthlySalary: salaryNum,
        payBank: draft.payBank.trim(),
        payAccountNo: draft.payAccountNo.trim(),
        payAccountName: draft.payAccountName.trim(),
        advanceBalance: advNum,
        skipGroupPayroll: draft.skipGroupPayroll,
      });
      const refreshed = await listActiveEmployeesWithPay();
      onEmployeesChange?.(refreshed);
      onInfo?.(
        [
          `บันทึก · ${emp.name}`,
          advNum > 0 ? `เบิกค้าง ฿${fmt(advNum)}` : "",
          draft.skipGroupPayroll ? "ข้ามรอบกลุ่ม" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setExpandedId(null);
    } catch (err) {
      onError((err as Error).message || "บันทึกเงินเดือนไม่สำเร็จ");
    } finally {
      setSavingId(null);
    }
  }

  if (!isOwner) {
    const me = selfEmployeeId
      ? roster.find((e) => e.id === selfEmployeeId) || null
      : null;
    const salary = me?.monthlySalary && me.monthlySalary > 0 ? me.monthlySalary : 0;
    const midAmt = salaryAmountForSplit(salary, mid.percent);
    const endAmt = salaryAmountForSplit(salary, end.percent);
    const bankBits = [me?.payBank, me?.payAccountNo, me?.payAccountName]
      .map((s) => (s || "").trim())
      .filter(Boolean);

    return (
      <section className="payroll-settings">
        <h2 className="payroll-settings-title">เงินเดือนของฉัน</h2>
        <p className="muted payroll-settings-hint">
          จ่าย 2 รอบ: วันที่ {mid.dayOfMonth} ({mid.percent}%) · วันที่ {end.dayOfMonth} (
          {end.percent}% + โบนัสเดือนที่แล้ว) · ดูได้เฉพาะของตัวเอง
        </p>
        {!me ? (
          <p className="empty">
            ยังไม่ได้เชื่อมชื่อกับรายชื่อร้าน — ไปโปรไฟล์เชื่อมชื่อก่อน จะเห็นเงินเดือนและคิวจ่ายของตัวเอง
          </p>
        ) : (
          <div className="sheet-scroll payroll-sheet sheet-bleed">
            <table className="sheet-table payroll-table payroll-table--self sheet-table--dense">
              <tbody>
                <tr>
                  <th scope="row">ชื่อ</th>
                  <td>{me.name}</td>
                </tr>
                <tr>
                  <th scope="row">เงินเดือน / เดือน</th>
                  <td>{salary > 0 ? `฿${fmt(salary)}` : "ยังไม่ตั้ง — ถามเจ้าของ"}</td>
                </tr>
                <tr>
                  <th scope="row">รอบกลางเดือน</th>
                  <td>
                    วันที่ {mid.dayOfMonth}
                    {salary > 0 ? ` · ≈ ฿${fmt(midAmt)}` : ""}
                  </td>
                </tr>
                <tr>
                  <th scope="row">รอบสิ้นเดือน</th>
                  <td>
                    โอนวันที่ {end.dayOfMonth}
                    {salary > 0 ? ` · ≈ ฿${fmt(endAmt)}` : ""}
                    {" · รวมโบนัสเดือนที่แล้ว (ถ้ามี)"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">เบิกค้าง</th>
                  <td>
                    {Number(me.advanceBalance) > 0
                      ? `฿${fmt(Number(me.advanceBalance))} (หักจากรอบจ่ายถัดไป)`
                      : "ไม่มี"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">บัญชีรับโอน</th>
                  <td>{bankBits.length ? bankBits.join(" · ") : "ยังไม่ระบุ"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  async function onSaveDocSettings() {
    if (!isOwner) return;
    setBusyDocSettings(true);
    try {
      const saved = await savePayrollPaymentDocSettings({
        payerName,
        payerTitle,
      });
      setPayerName(saved.payerName);
      setPayerTitle(saved.payerTitle);
      onInfo?.(
        `บันทึกเอกสารจ่ายแล้ว · ผู้จ่าย ${saved.payerName}${saved.payerTitle ? ` (${saved.payerTitle})` : ""}`,
      );
    } catch (err) {
      onError((err as Error).message || "บันทึกเอกสารจ่ายไม่สำเร็จ");
    } finally {
      setBusyDocSettings(false);
    }
  }

  return (
    <section className="payroll-settings">
      <div className="payroll-settings-block">
        <h2 className="payroll-settings-title">0) เอกสารหลักฐานจ่าย</h2>
        <p className="muted payroll-settings-hint">
          ชื่อผู้จ่ายบนใบสรุป · ผู้รับใช้ชื่อจริง–นามสกุลจากโปรไฟล์พนักงาน
        </p>
        <div className="payroll-round-cards">
          <div className="payroll-round-card" style={{ gridColumn: "1 / -1" }}>
            <label className="field">
              <span>ชื่อผู้จ่าย</span>
              <input
                type="text"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                disabled={busyDocSettings}
                placeholder="พีระพงษ์ โยหาเคน"
              />
            </label>
            <label className="field">
              <span>ตำแหน่ง / อื่นๆ</span>
              <input
                type="text"
                value={payerTitle}
                onChange={(e) => setPayerTitle(e.target.value)}
                disabled={busyDocSettings}
                placeholder="เจ้าของกิจการ"
              />
            </label>
            <div className="payroll-latest-transfer-actions" style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="primary-btn"
                disabled={busyDocSettings}
                onClick={() => void onSaveDocSettings()}
              >
                {busyDocSettings ? "กำลังบันทึก…" : "บันทึกเอกสารจ่าย"}
              </button>
            </div>
          </div>
        </div>
      </div>

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
            <span className="payroll-round-label">รอบที่ 2 · สิ้นเดือน</span>
            <label className="field">
              <span>วันโอน (เดือนถัดไป)</span>
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
              ของสิ้นเดือนก่อนหน้า · ลงบัญชีวันสิ้นเดือน · โอนวันที่ตั้งไว้ (ค่าเริ่มต้น 1)
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
          ใส่ยอดต่อเดือน · เบิกใหม่ใช้แท็บรอโอน「บันทึกเบิก」(วัน+สลิป+บช.) ·
          ช่องเบิกค้างที่นี่แก้ยอดเก่าอย่างเดียว · ติ๊กข้ามรอบกลุ่มได้ถ้าจ่ายแยกก่อน
          {missingSalary ? ` · ยังไม่ตั้งเงินเดือน ${missingSalary} คน` : ""}
          {withAdvance ? ` · มีเบิกค้าง ${withAdvance} คน` : ""}
          {skipGroupCount ? ` · ข้ามรอบกลุ่ม ${skipGroupCount} คน` : ""}
        </p>

        {!roster.length ? (
          <p className="empty">ยังไม่มีพนักงานใช้งาน — เพิ่มชื่อที่ศูนย์พนักงานก่อน</p>
        ) : (
          <>
            <div className="sheet-scroll payroll-sheet sheet-bleed">
              <table className="sheet-table payroll-table sheet-table--dense">
                <thead>
                  <tr>
                    <th className="payroll-col-name">ชื่อ</th>
                    <th className="payroll-col-amt col-out">/เดือน</th>
                    <th className="payroll-col-split">กลาง</th>
                    <th className="payroll-col-split">สิ้นเดือน</th>
                    <th className="payroll-col-adv">เบิกค้าง</th>
                    <th className="payroll-col-act col-act" />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((emp) => {
                    const draft = drafts[emp.id] || draftFromEmployee(emp);
                    const salaryNum = Number(draft.monthlySalary) || 0;
                    const midAmt = salaryAmountForSplit(salaryNum, midPctN);
                    const endAmt = salaryAmountForSplit(salaryNum, endPctN);
                    const open = expandedId === emp.id;
                    const busy = savingId === emp.id;
                    const adv = Number(emp.advanceBalance) || 0;
                    return (
                      <tr
                        key={emp.id}
                        className={
                          open
                            ? "payroll-tr is-expanded"
                            : salaryNum > 0
                              ? "payroll-tr"
                              : "payroll-tr is-missing-salary"
                        }
                      >
                        <td className="payroll-col-name">
                          <strong>{emp.name}</strong>
                          {(draft.skipGroupPayroll ||
                            ((draft.payBank || draft.payAccountNo) && !open)) ? (
                            <div className="muted payroll-cell-meta">
                              {[
                                draft.skipGroupPayroll ? "ข้ามรอบกลุ่ม" : "",
                                !open
                                  ? [draft.payBank, draft.payAccountNo].filter(Boolean).join(" ")
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          ) : null}
                        </td>
                        <td className="payroll-col-amt col-out">
                          {salaryNum > 0 ? `฿${fmt(salaryNum)}` : "—"}
                        </td>
                        <td className="payroll-col-split">
                          {salaryNum > 0 ? `฿${fmt(midAmt)}` : "—"}
                        </td>
                        <td className="payroll-col-split">
                          {salaryNum > 0 ? `฿${fmt(endAmt)}` : "—"}
                        </td>
                        <td className="payroll-col-adv">{adv > 0 ? `฿${fmt(adv)}` : "—"}</td>
                        <td className="payroll-col-act col-act">
                          <button
                            type="button"
                            className="ghost-btn payroll-table-btn"
                            disabled={!!savingId}
                            onClick={() => setExpandedId(open ? null : emp.id)}
                          >
                            {open ? "ปิด" : "ตั้ง"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {expandedId
              ? (() => {
                  const emp = roster.find((e) => e.id === expandedId);
                  if (!emp) return null;
                  const draft = drafts[emp.id] || draftFromEmployee(emp);
                  const salaryNum = Number(draft.monthlySalary) || 0;
                  const midAmt = salaryAmountForSplit(salaryNum, midPctN);
                  const endAmt = salaryAmountForSplit(salaryNum, endPctN);
                  const busy = savingId === emp.id;
                  return (
                    <div className="payroll-salary-edit">
                      <strong className="payroll-salary-edit-title">ตั้งค่า · {emp.name}</strong>
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
                      <label className="field">
                        <span>เบิกค้าง (บาท)</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          inputMode="decimal"
                          value={draft.advanceBalance}
                          onChange={(e) => patchDraft(emp.id, { advanceBalance: e.target.value })}
                          disabled={busy}
                          placeholder="เช่น 2000 — ว่าง = ไม่มี"
                        />
                      </label>
                      <label className="payroll-special-skip">
                        <input
                          type="checkbox"
                          checked={draft.skipGroupPayroll}
                          onChange={(e) =>
                            patchDraft(emp.id, { skipGroupPayroll: e.target.checked })
                          }
                          disabled={busy}
                        />
                        ข้ามตอนกด «สร้างเงินเดือน/โบนัส» กลุ่ม — ใช้ตอนจ่ายแยกก่อนเข้ารอบปกติ
                      </label>
                      <p className="muted form-hint-inline">
                        เบิกค้างที่นี่ = แก้ยอดอย่างเดียว (ไม่ลงสมุด) · เบิกใหม่ที่มีวัน+สลิปไปแท็บรอโอน →「บันทึกเบิก」
                        {salaryNum > 0
                          ? ` · ตัวอย่างก่อนหัก: วันที่ ${midDay} = ฿${fmt(midAmt)} · สิ้นเดือนโอนวันที่ ${endDay} = ฿${fmt(endAmt)}`
                          : ""}
                      </p>
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
                  );
                })()
              : null}
          </>
        )}
      </div>

      <p className="muted payroll-settings-foot">
        ตั้งเสร็จแล้วไปแท็บ <strong>รอโอน</strong> กดสร้างรายการ — ระบบจะเตรียมคิวให้โอนตามรอบ
      </p>
    </section>
  );
}
