"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { PayrollPayPanel } from "@/components/PayrollPayPanel";
import { PayrollSettingsPanel } from "@/components/PayrollSettingsPanel";
import { useAuth } from "@/lib/auth";
import {
  saveBonusDeductionMonthQty,
  saveBonusDeductionRulePct,
  subscribeBonusDeductionMonth,
  subscribeBonusDeductionSettings,
  type BonusDeductionMonthDoc,
  type BonusDeductionRule,
  type BonusDeductionRuleId,
  type BonusDeductionSettings,
} from "@/lib/bonus-deductions";
import {
  computeMonthBonus,
  namesMatch,
  parseMonthInput,
  pickMyBonusRow,
  thaiMonthYearLabel,
  type MonthBonusReport,
} from "@/lib/bonus";
import { RateSchedulePanel } from "@/components/RateSchedulePanel";
import { listActiveEmployees, resolveLinkedEmployee, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import { getOtSettings, subscribeOtEntries, type OtEntry } from "@/lib/ot";
import {
  DEFAULT_PAYROLL_SCHEDULE,
  suggestPeriodMonthForToday,
  subscribePayrollItems,
  subscribePayrollSchedule,
  type PayrollItem,
  type PayrollSchedule,
} from "@/lib/payroll";
import { subscribeProdEntries, type ProdEntry } from "@/lib/production";
import { subscribeRateSchedule, type RateScheduleEntry } from "@/lib/rate-schedule";
import { formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

function fmtPct(n: number) {
  return n % 1 === 0 ? `${n.toFixed(0)}%` : `${n.toFixed(2)}%`;
}

type EditTarget =
  | { kind: "rate"; rule: BonusDeductionRule }
  | { kind: "qty"; rule: BonusDeductionRule; qty: number };

type PayTab = "pay" | "bonus" | "settings";

export default function BonusPage() {
  return (
    <AuthGate>
      <BonusView />
    </AuthGate>
  );
}

function BonusView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [month, setMonth] = useState(() => suggestPeriodMonthForToday());
  const [tab, setTab] = useState<PayTab>("bonus");
  const [otEntries, setOtEntries] = useState<OtEntry[]>([]);
  const [prodEntries, setProdEntries] = useState<ProdEntry[]>([]);
  const [deductionSettings, setDeductionSettings] = useState<BonusDeductionSettings | null>(null);
  const [deductionMonth, setDeductionMonth] = useState<BonusDeductionMonthDoc | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [otSettingsRate, setOtSettingsRate] = useState(0.6);
  const [rateSchedule, setRateSchedule] = useState<RateScheduleEntry[]>([]);
  const [payrollSchedule, setPayrollSchedule] = useState<PayrollSchedule>(DEFAULT_PAYROLL_SCHEDULE);
  const [payrollItems, setPayrollItems] = useState<PayrollItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const canView = can(staff, "bonus");
  const canPay = isOwner || can(staff, "ownerBooks");
  /** คิวทั้งร้าน: เจ้าของ หรือคนที่มีสิทธิ์โอน — พนักงานทั่วไปเห็นเฉพาะของตัวเอง */
  const shopPayView = isOwner || canPay;
  const { year, month: monthIdx } = parseMonthInput(month);

  useBodyScrollLock(!!editTarget);

  useEffect(() => {
    if (staff && !canView) router.replace("/ledger/");
  }, [staff, router, canView]);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    void Promise.all([listActiveEmployees(), getOtSettings()])
      .then(([emps, otSettings]) => {
        setEmployees(emps);
        setOtSettingsRate(otSettings.bonusRate);
      })
      .catch((err) => setError((err as Error).message || "โหลดพนักงานไม่สำเร็จ"))
      .finally(() => setLoading(false));

    const monthSince = new Date(year, monthIdx, 1).getTime();
    const monthUntil = new Date(year, monthIdx + 1, 1).getTime();
    // payroll dueDate อาจข้ามเดือน — เผื่อเดือนก่อน/หลังเล็กน้อย
    const payrollSince = new Date(year, monthIdx - 1, 1).getTime();
    const unsubOt = subscribeOtEntries(
      (rows) => setOtEntries(rows),
      (err) => setError(err.message),
      { since: monthSince, until: monthUntil },
    );
    const unsubProd = subscribeProdEntries(
      (rows) => setProdEntries(rows),
      (err) => setError(err.message),
      { since: monthSince, until: monthUntil },
    );
    const unsubSettings = subscribeBonusDeductionSettings(
      (settings) => setDeductionSettings(settings),
      (err) => setError(err.message),
    );
    const unsubSchedule = subscribeRateSchedule(
      (doc) => setRateSchedule(doc.entries),
      (err) => setError(err.message),
    );
    const unsubPayrollSchedule = subscribePayrollSchedule(
      (doc) => setPayrollSchedule(doc),
      (err) => setError(err.message),
    );
    const unsubPayrollItems = subscribePayrollItems(
      (rows) => setPayrollItems(rows),
      (err) => setError(err.message),
      { since: payrollSince },
    );
    return () => {
      unsubOt();
      unsubProd();
      unsubSettings();
      unsubSchedule();
      unsubPayrollSchedule();
      unsubPayrollItems();
    };
  }, [staff, canView, year, monthIdx]);

  useEffect(() => {
    if (!canView) return;
    const unsubMonth = subscribeBonusDeductionMonth(
      year,
      monthIdx,
      (doc) => setDeductionMonth(doc),
      (err) => setError(err.message),
    );
    return () => unsubMonth();
  }, [canView, year, monthIdx]);

  const report = useMemo(() => {
    if (!deductionSettings || !deductionMonth) return null;
    return computeMonthBonus(
      otEntries,
      prodEntries,
      employees,
      year,
      monthIdx,
      deductionSettings.rules,
      deductionMonth.counts,
      rateSchedule,
    );
  }, [
    otEntries,
    prodEntries,
    employees,
    deductionSettings,
    deductionMonth,
    year,
    monthIdx,
    rateSchedule,
  ]);

  const myEmployee = useMemo(
    () => resolveLinkedEmployee(employees, staff),
    [employees, staff],
  );

  const myRow = useMemo(() => {
    if (!report) return null;
    if (myEmployee) {
      const byId = report.rows.find((r) => r.workerId === myEmployee.id);
      if (byId) return byId;
      return report.rows.find((r) => namesMatch(r.workerName, myEmployee.name)) || null;
    }
    return pickMyBonusRow(report, employees, staff?.displayName);
  }, [report, employees, staff?.displayName, myEmployee]);

  const bonusByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    if (!report) return map;
    for (const row of report.rows) {
      if (row.workerId) map[row.workerId] = row.remaining;
    }
    return map;
  }, [report]);

  const visiblePayrollItems = useMemo(() => {
    if (shopPayView) return payrollItems;
    if (!myEmployee) return [];
    return payrollItems.filter((i) => i.employeeId === myEmployee.id);
  }, [payrollItems, shopPayView, myEmployee]);

  const pendingCount = useMemo(
    () => visiblePayrollItems.filter((i) => i.status === "pending").length,
    [visiblePayrollItems],
  );

  if (!canView) return null;

  return (
    <div className="module-page bonus-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <CircleDollarSign size={18} aria-hidden />
          จ่าย / โบนัส
        </h1>
      </div>

      <div className="payroll-tabs" role="tablist" aria-label="จ่ายและโบนัส">
        <button
          type="button"
          role="tab"
          className={tab === "bonus" ? "is-active" : ""}
          aria-selected={tab === "bonus"}
          onClick={() => setTab("bonus")}
        >
          สรุปโบนัส
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "pay" ? "is-active" : ""}
          aria-selected={tab === "pay"}
          onClick={() => setTab("pay")}
        >
          รอโอน{pendingCount ? ` (${pendingCount})` : ""}
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "settings" ? "is-active" : ""}
          aria-selected={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          {isOwner ? "ตั้งค่าจ่าย" : "เงินเดือนฉัน"}
        </button>
      </div>

      {tab !== "settings" ? (
        <div className="bonus-toolbar">
          <input
            type="month"
            className="ot-slim-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="เดือนอ้างอิง"
          />
          <span className="bonus-toolbar-meta muted">
            {report
              ? `${thaiMonthYearLabel(report.year, report.month)} · หารขาย ${report.employeeCount} คน`
              : "…"}
          </span>
        </div>
      ) : (
        <p className="muted bonus-toolbar-meta" style={{ margin: "0.25rem 0 0.65rem" }}>
          {isOwner
            ? "ตั้งเงินเดือนและรอบจ่ายที่นี่ · ไม่ต้องไปหน้าอื่น"
            : "ดูเงินเดือนและรอบจ่ายของตัวเอง · ไม่เห็นยอดคนอื่น"}
        </p>
      )}

      {error ? <p className="error-text">{error}</p> : null}
      {info ? <p className="success-text">{info}</p> : null}

      {tab === "pay" ? (
        loading || !report ? (
          <p className="empty">กำลังโหลด...</p>
        ) : (
          <PayrollPayPanel
            isOwner={isOwner}
            shopView={shopPayView}
            actorId={actorId}
            periodMonth={month}
            employees={employees}
            schedule={payrollSchedule}
            items={visiblePayrollItems}
            bonusByEmployee={bonusByEmployee}
            prodEntries={prodEntries}
            otEntries={otEntries}
            canPay={canPay}
            onError={setError}
            onInfo={(msg) => {
              setInfo(msg);
              setError(null);
            }}
          />
        )
      ) : null}

      {tab === "settings" ? (
        <PayrollSettingsPanel
          schedule={payrollSchedule}
          employees={employees}
          isOwner={isOwner}
          selfEmployeeId={myEmployee?.id ?? null}
          onEmployeesChange={setEmployees}
          onError={setError}
          onInfo={(msg) => {
            setInfo(msg);
            setError(null);
          }}
        />
      ) : null}

      {tab === "bonus" ? (
        <>
          {loading || !report ? <p className="empty">กำลังโหลด...</p> : null}

          {/* สรุปพูลทั้งร้าน + ตารางรายคน: เจ้าของ / คนโอนเท่านั้น — พนักงานเห็นแค่ของฉัน */}
          {report && shopPayView ? (
            <div className="bonus-summary-bar">
              <div className="bonus-summary-pool">
                <span className="bonus-summary-label">โบนัสขายเบเกอรี่ รวม</span>
                <strong className="bonus-summary-pool-amt">฿{fmt(report.totalSalesPool)}</strong>
                <span className="muted bonus-summary-pool-meta">
                  จากผลิต {fmt(report.totalProdQty)} ชิ้น × เรทขายตามวัน (ตารางเรท)
                </span>
              </div>
              <div className="bonus-summary-total">
                <span className="bonus-summary-label">คงเหลือรวม</span>
                <strong>฿{fmt(report.totalRemaining)}</strong>
              </div>
            </div>
          ) : null}

          {!loading && report && myRow ? (
            <section className="bonus-my-card">
              <header className="bonus-my-head">
                <div>
                  <span className="bonus-my-label">ของฉัน</span>
                  <h2 className="bonus-my-name">{myRow.workerName}</h2>
                </div>
                <p className="bonus-my-total">฿{fmt(myRow.remaining)}</p>
              </header>
              <dl className="bonus-my-grid">
                <div>
                  <dt>ขายเบเกอรี่</dt>
                  <dd>฿{fmt(myRow.salesShare)}</dd>
                </div>
                <div>
                  <dt>ผลิตเบเกอรี่</dt>
                  <dd>฿{fmt(myRow.prodBonus)}</dd>
                </div>
                <div>
                  <dt>โบนัสชง</dt>
                  <dd>฿{fmt(myRow.otMain)}</dd>
                </div>
                <div>
                  <dt>รวม</dt>
                  <dd>฿{fmt(myRow.total)}</dd>
                </div>
                <div>
                  <dt>หักโบนัส ({fmtPct(myRow.deductPct)})</dt>
                  <dd className="bonus-my-deduct">−฿{fmt(myRow.deductAmount)}</dd>
                </div>
              </dl>
              <p className="muted bonus-live-note">
                หักตามกติการ้าน · อัปเดตเมื่อมีการกรอกชง / ผลิต · ไม่แสดงยอดคนอื่น
              </p>
            </section>
          ) : null}

          {!loading && report && !myRow && !shopPayView ? (
            <p className="muted bonus-no-match">
              {staff?.displayName
                ? <>ไม่พบชื่อ &quot;{staff.displayName}&quot; ในรายชื่อพนักงาน — ตรวจที่{" "}</>
                : <>ยังไม่ได้เชื่อมชื่อกับรายชื่อร้าน — ไปที่{" "}</>}
              <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
              {" "}หรือโปรไฟล์ เพื่อเห็นโบนัสของตัวเอง
            </p>
          ) : null}

          {!loading && report && shopPayView ? (
            <BonusTable report={report} highlightName={myRow?.workerName} />
          ) : null}

          {report && shopPayView ? (
            <p className="muted bonus-footnote">
              ขาย = จำนวนผลิต × เรทขายจากตารางเรท (ตามวันผลิต) แล้วหารคนที่ลงทะเบียนทำงานในเดือน
              (ผลิตหรือชง) — มีชื่ออย่างเดียวไม่หาร · ผลิต/ชง จากยอดจริง · เจ้าของกรอกจำนวนหักทั้งร้านสิ้นเดือน ·
              เรท% ถาวร
            </p>
          ) : null}

          {report ? (
            <BonusDeductionSummaryTable
              report={report}
              isOwner={isOwner}
              onEditRate={(rule) => setEditTarget({ kind: "rate", rule })}
              onEditQty={(rule, qty) => setEditTarget({ kind: "qty", rule, qty })}
            />
          ) : null}

          <RateSchedulePanel
            isOwner={isOwner}
            actorId={actorId}
            otSettingsFallback={otSettingsRate}
            onError={setError}
          />
        </>
      ) : null}

      {editTarget ? (
        <BonusEditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onError={setError}
          year={year}
          month={monthIdx}
        />
      ) : null}
    </div>
  );
}

function BonusDeductionSummaryTable({
  report,
  isOwner,
  onEditRate,
  onEditQty,
}: {
  report: MonthBonusReport;
  isOwner: boolean;
  onEditRate: (rule: BonusDeductionRule) => void;
  onEditQty: (rule: BonusDeductionRule, qty: number) => void;
}) {
  const lines = report.deductionLines;

  return (
    <div className="sheet-wrap bonus-deduct-wrap sheet-bleed">
      <table className="sheet-table bonus-deduct-table sheet-table--dense">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="col-out">จำนวน</th>
            <th className="col-out">เรท%</th>
            <th className="col-out bonus-th-line-pct">รวม%</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.label}</td>
              <td className="col-out">
                {isOwner ? (
                  <button
                    type="button"
                    className="bonus-edit-cell"
                    onClick={() =>
                      onEditQty(
                        { id: line.id, label: line.label, pctPerUnit: line.ratePct },
                        line.qty,
                      )
                    }
                    title="แตะเพื่อแก้จำนวน (เดือนนี้)"
                  >
                    {line.qty}
                  </button>
                ) : (
                  line.qty
                )}
              </td>
              <td className="col-out">
                {isOwner ? (
                  <button
                    type="button"
                    className="bonus-edit-cell"
                    onClick={() =>
                      onEditRate({ id: line.id, label: line.label, pctPerUnit: line.ratePct })
                    }
                    title="แตะเพื่อแก้เรท% (ถาวร)"
                  >
                    {fmtPct(line.ratePct)}
                  </button>
                ) : (
                  fmtPct(line.ratePct)
                )}
              </td>
              <td className="col-out bonus-th-line-pct">{fmtPct(line.linePct)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bonus-deduct-foot-row">
            <td colSpan={3}>หักโบนัสรวม</td>
            <td className="col-out bonus-th-line-pct">
              <strong>{fmtPct(report.shopDeductPct)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="muted bonus-deduct-note">
        {isOwner
          ? "กรอกจำนวนสิ้นเดือน · แตะเรท% แก้ถาวร · รวม% นำไปหักทุกคน"
          : "กติกาหักโบนัสทั้งร้าน — ไม่แสดงยอดรายคน"}
      </p>
    </div>
  );
}

function BonusTable({
  report,
  highlightName,
}: {
  report: MonthBonusReport;
  highlightName?: string;
}) {
  if (!report.rows.length) {
    return <p className="empty">ยังไม่มีข้อมูลโบนัสในเดือนนี้</p>;
  }

  return (
    <div className="sheet-wrap bonus-sheet-wrap sheet-bleed">
      <table className="sheet-table bonus-table sheet-table--dense">
        <thead>
          <tr>
            <th className="bonus-th-name">ชื่อ</th>
            <th className="col-out">ขาย</th>
            <th className="col-out">ผลิต</th>
            <th className="col-out">ชง</th>
            <th className="col-out">รวม</th>
            <th className="col-out bonus-th-deduct">หักโบนัส</th>
            <th className="col-out bonus-th-final">คงเหลือ</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            const mine = highlightName && row.workerName === highlightName;
            return (
              <tr key={row.workerId + row.workerName} className={mine ? "bonus-row-mine" : ""}>
                <td className="bonus-th-name">{row.workerName}</td>
                <td className="col-out">{fmt(row.salesShare)}</td>
                <td className="col-out">{fmt(row.prodBonus)}</td>
                <td className="col-out">{fmt(row.otMain)}</td>
                <td className="col-out">{fmt(row.total)}</td>
                <td className="col-out bonus-th-deduct">
                  {row.deductAmount > 0 ? (
                    <>
                      <span className="bonus-deduct-pct">{fmtPct(row.deductPct)}</span>
                      <span className="bonus-deduct-amt">−{fmt(row.deductAmount)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-out bonus-th-final">
                  <strong>฿{fmt(row.remaining)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bonus-foot-row">
            <td colSpan={5}>รวมทั้งร้าน</td>
            <td className="col-out bonus-th-deduct">−{fmt(report.totalDeducted)}</td>
            <td className="col-out bonus-th-final">
              <strong>฿{fmt(report.totalRemaining)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function BonusEditModal({
  target,
  onClose,
  onError,
  year,
  month,
}: {
  target: EditTarget;
  onClose: () => void;
  onError: (msg: string) => void;
  year: number;
  month: number;
}) {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(
    target.kind === "rate" ? String(target.rule.pctPerUnit) : String(target.qty),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (target.kind === "rate") {
        await saveBonusDeductionRulePct(target.rule.id as BonusDeductionRuleId, Number(value));
      } else {
        await saveBonusDeductionMonthQty(year, month, target.rule.id as BonusDeductionRuleId, Number(value));
      }
      onClose();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const title =
    target.kind === "rate"
      ? `เรท% — ${target.rule.label}`
      : `จำนวน — ${target.rule.label}`;

  return (
    <div className="modal-backdrop edit-modal is-module-form" onClick={onClose}>
      <form
        className="modal-card module-form-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void onSubmit(e)}
      >
        <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>
          {title}
        </h2>

        <div className="field">
          <label htmlFor="bonus-edit-value">
            {target.kind === "rate" ? "เรท % ต่อหน่วย" : "จำนวน (ทั้งร้าน เดือนนี้)"}
          </label>
          <input
            id="bonus-edit-value"
            type="number"
            min="0"
            step={target.kind === "rate" ? "0.01" : "1"}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
          />
          <p className="muted form-hint-inline">
            {target.kind === "rate" ? "เรทถาวร — ใช้ทุกเดือน" : "กรอกตอนจ่ายโบนัสสิ้นเดือน"}
          </p>
        </div>

        <div className="module-form-actions">
          <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </form>
    </div>
  );
}
