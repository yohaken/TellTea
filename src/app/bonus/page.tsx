"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  saveBonusDeductionRulePct,
  saveWorkerDeductionCounts,
  subscribeBonusDeductionMonth,
  subscribeBonusDeductionSettings,
  type BonusDeductionMonthDoc,
  type BonusDeductionRule,
  type BonusDeductionRuleId,
  type BonusDeductionSettings,
} from "@/lib/bonus-deductions";
import {
  computeMonthBonus,
  monthInputValue,
  parseMonthInput,
  pickMyBonusRow,
  thaiMonthYearLabel,
  type MonthBonusReport,
  type WorkerMonthBonus,
} from "@/lib/bonus";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import { subscribeOtEntries, type OtEntry } from "@/lib/ot";
import { subscribeProdEntries, type ProdEntry } from "@/lib/production";
import { formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function fmt(n: number) {
  return formatPlainNumber(n);
}

function fmtPct(n: number) {
  return n % 1 === 0 ? `${n.toFixed(0)}%` : `${n.toFixed(2)}%`;
}

type EditTarget =
  | { kind: "rule"; rule: BonusDeductionRule }
  | { kind: "counts"; row: WorkerMonthBonus };

export default function BonusPage() {
  return (
    <AuthGate>
      <BonusView />
    </AuthGate>
  );
}

function BonusView() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [month, setMonth] = useState(monthInputValue());
  const [otEntries, setOtEntries] = useState<OtEntry[]>([]);
  const [prodEntries, setProdEntries] = useState<ProdEntry[]>([]);
  const [deductionSettings, setDeductionSettings] = useState<BonusDeductionSettings | null>(null);
  const [deductionMonth, setDeductionMonth] = useState<BonusDeductionMonthDoc | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(isOwner);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const canView = can(staff, "bonus");
  const { year, month: monthIdx } = parseMonthInput(month);

  useBodyScrollLock(!!editTarget);

  useEffect(() => {
    if (staff && !canView) router.replace("/ledger/");
  }, [staff, router, canView]);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    void listActiveEmployees()
      .then(setEmployees)
      .catch((err) => setError((err as Error).message || "โหลดพนักงานไม่สำเร็จ"))
      .finally(() => setLoading(false));

    const unsubOt = subscribeOtEntries(
      (rows) => setOtEntries(rows),
      (err) => setError(err.message),
    );
    const unsubProd = subscribeProdEntries(
      (rows) => setProdEntries(rows),
      (err) => setError(err.message),
    );
    const unsubSettings = subscribeBonusDeductionSettings(
      (settings) => setDeductionSettings(settings),
      (err) => setError(err.message),
    );
    return () => {
      unsubOt();
      unsubProd();
      unsubSettings();
    };
  }, [staff, canView]);

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
      deductionMonth.workers,
    );
  }, [otEntries, prodEntries, employees, deductionSettings, deductionMonth, year, monthIdx]);

  const myRow = useMemo(
    () => (report ? pickMyBonusRow(report, employees, staff?.displayName) : null),
    [report, employees, staff?.displayName],
  );

  if (!canView) return null;

  return (
    <div className="module-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <CircleDollarSign size={18} aria-hidden />
          สรุปโบนัสเดือน
        </h1>
      </div>

      <div className="bonus-toolbar">
        <input
          type="month"
          className="ot-slim-input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="เดือน"
        />
        <span className="bonus-toolbar-meta muted">
          {report
            ? `${thaiMonthYearLabel(report.year, report.month)} · ${report.employeeCount} คน`
            : "…"}
        </span>
      </div>

      {report ? (
        <>
          <div className="bonus-summary-bar">
            <div className="bonus-summary-pool">
              <span className="bonus-summary-label">โบนัสขายเบเกอรี่ รวม</span>
              <strong className="bonus-summary-pool-amt">฿{fmt(report.totalSalesPool)}</strong>
            </div>
            <div className="bonus-summary-total">
              <span className="bonus-summary-label">คงเหลือรวม</span>
              <strong>฿{fmt(report.totalRemaining)}</strong>
            </div>
          </div>

          <BonusDeductionRulesTable
            rules={deductionSettings?.rules || []}
            isOwner={isOwner}
            onEditRule={(rule) => setEditTarget({ kind: "rule", rule })}
          />
        </>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {loading || !report ? <p className="empty">กำลังโหลด...</p> : null}

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
              <dt>โบนัสหลัก OT</dt>
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
            <div>
              <dt>ผิดพลาด / ของเสีย</dt>
              <dd>
                {myRow.generalFailCount} / {fmt(myRow.wasteQty)}
              </dd>
            </div>
          </dl>
          <p className="muted bonus-live-note">
            อัปเดตทันทีเมื่อมีการกรอก OT / ผลิต · จำนวนหักโดยเจ้าของ
          </p>
        </section>
      ) : null}

      {!loading && report && !myRow && staff?.displayName ? (
        <p className="muted bonus-no-match">
          ไม่พบชื่อ &quot;{staff.displayName}&quot; ในรายชื่อพนักงาน — ตรวจที่{" "}
          <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
        </p>
      ) : null}

      {!isOwner ? (
        <button
          type="button"
          className="ghost-btn bonus-toggle-all"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "ซ่อนตารางทั้งร้าน" : "ดูตารางทั้งร้าน"}
        </button>
      ) : null}

      {!loading && report && (isOwner || showAll) ? (
        <BonusTable
          report={report}
          highlightName={myRow?.workerName}
          isOwner={isOwner}
          onEditCounts={(row) => setEditTarget({ kind: "counts", row })}
        />
      ) : null}

      {report ? (
        <p className="muted bonus-footnote">
          ขาย = pool รวม ÷ จำนวนคน · ผลิต/OT จากยอดจริง · เจ้าของกรอกจำนวนหักต่อคน · % เรทถาวรใช้ทุกเดือน
        </p>
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

function BonusDeductionRulesTable({
  rules,
  isOwner,
  onEditRule,
}: {
  rules: BonusDeductionRule[];
  isOwner: boolean;
  onEditRule: (rule: BonusDeductionRule) => void;
}) {
  return (
    <div className="sheet-wrap bonus-deduct-wrap">
      <table className="sheet-table bonus-deduct-table">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="col-out">%</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td>{rule.label}</td>
              <td className="col-out">
                {isOwner ? (
                  <button
                    type="button"
                    className="bonus-edit-cell"
                    onClick={() => onEditRule(rule)}
                    title="แตะเพื่อแก้ %"
                  >
                    {fmtPct(rule.pctPerUnit)}
                  </button>
                ) : (
                  fmtPct(rule.pctPerUnit)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted bonus-deduct-note">
        {isOwner
          ? "แตะ % เพื่อแก้เรทถาวร · กรอกจำนวนต่อคนในตารางด้านล่าง"
          : "เรทหักโบนัส — เจ้าของกำหนดจำนวนหักต่อคนในแต่ละเดือน"}
      </p>
    </div>
  );
}

function BonusTable({
  report,
  highlightName,
  isOwner,
  onEditCounts,
}: {
  report: MonthBonusReport;
  highlightName?: string;
  isOwner: boolean;
  onEditCounts: (row: WorkerMonthBonus) => void;
}) {
  if (!report.rows.length) {
    return <p className="empty">ยังไม่มีข้อมูลโบนัสในเดือนนี้</p>;
  }

  return (
    <div className="sheet-wrap bonus-sheet-wrap">
      <table className="sheet-table bonus-table">
        <thead>
          <tr>
            <th className="bonus-th-name">ชื่อ</th>
            <th className="col-out">ขาย</th>
            <th className="col-out">ผลิต</th>
            <th className="col-out">OT</th>
            <th className="col-out">รวม</th>
            <th className="col-out bonus-th-count">ผิด</th>
            <th className="col-out bonus-th-count">เสีย</th>
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
                <td className="col-out bonus-th-count">
                  {isOwner ? (
                    <button
                      type="button"
                      className="bonus-edit-cell"
                      onClick={() => onEditCounts(row)}
                      title="แตะเพื่อแก้จำนวนผิดพลาด / ของเสีย"
                    >
                      {row.generalFailCount}
                    </button>
                  ) : (
                    row.generalFailCount
                  )}
                </td>
                <td className="col-out bonus-th-count">
                  {isOwner ? (
                    <button
                      type="button"
                      className="bonus-edit-cell"
                      onClick={() => onEditCounts(row)}
                      title="แตะเพื่อแก้จำนวนผิดพลาด / ของเสีย"
                    >
                      {fmt(row.wasteQty)}
                    </button>
                  ) : (
                    fmt(row.wasteQty)
                  )}
                </td>
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
            <td colSpan={7}>รวมทั้งร้าน</td>
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
  const [pct, setPct] = useState(
    target.kind === "rule" ? String(target.rule.pctPerUnit) : "",
  );
  const [generalFailCount, setGeneralFailCount] = useState(
    target.kind === "counts" ? String(target.row.generalFailCount) : "0",
  );
  const [wasteQty, setWasteQty] = useState(
    target.kind === "counts" ? String(target.row.wasteQty) : "0",
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (target.kind === "rule") {
        await saveBonusDeductionRulePct(target.rule.id as BonusDeductionRuleId, Number(pct));
      } else {
        await saveWorkerDeductionCounts(year, month, target.row.workerId, {
          generalFailCount: Number(generalFailCount) || 0,
          wasteQty: Number(wasteQty) || 0,
        });
      }
      onClose();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const title =
    target.kind === "rule"
      ? `แก้เรท ${target.rule.label}`
      : `หักโบนัส — ${target.row.workerName}`;

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

        {target.kind === "rule" ? (
          <div className="field">
            <label htmlFor="bonus-rule-pct">หัก % ต่อครั้ง/หน่วย</label>
            <input
              id="bonus-rule-pct"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              required
              autoFocus
            />
            <p className="muted form-hint-inline">เรทถาวร — ใช้ทุกเดือน</p>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="bonus-fail-count">ผิดพลาดทั่วไป (ครั้ง)</label>
              <input
                id="bonus-fail-count"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={generalFailCount}
                onChange={(e) => setGeneralFailCount(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="bonus-waste-qty">ของเสีย (หน่วย)</label>
              <input
                id="bonus-waste-qty"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={wasteQty}
                onChange={(e) => setWasteQty(e.target.value)}
                required
              />
            </div>
          </>
        )}

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
