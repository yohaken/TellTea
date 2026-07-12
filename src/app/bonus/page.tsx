"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  BONUS_DEDUCTION_RULES,
  computeMonthBonus,
  monthInputValue,
  parseMonthInput,
  pickMyBonusRow,
  thaiMonthYearLabel,
  type MonthBonusReport,
} from "@/lib/bonus";
import { subscribeChecklistRecords, type ChecklistRecord } from "@/lib/checklist";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import { subscribeOtEntries, type OtEntry } from "@/lib/ot";
import { subscribeProdEntries, type ProdEntry } from "@/lib/production";
import { formatPlainNumber } from "@/lib/utils";

function fmt(n: number) {
  return formatPlainNumber(n);
}

function fmtPct(n: number) {
  return n % 1 === 0 ? `${n.toFixed(0)}%` : `${n.toFixed(2)}%`;
}

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
  const [checkRecords, setCheckRecords] = useState<ChecklistRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(isOwner);

  const canView = can(staff, "bonus");

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
    const unsubCheck = subscribeChecklistRecords(
      (rows) => setCheckRecords(rows),
      (err) => setError(err.message),
    );
    return () => {
      unsubOt();
      unsubProd();
      unsubCheck();
    };
  }, [staff, canView]);

  const report = useMemo(() => {
    const { year, month: m } = parseMonthInput(month);
    return computeMonthBonus(otEntries, prodEntries, employees, year, m, checkRecords);
  }, [otEntries, prodEntries, employees, checkRecords, month]);

  const myRow = useMemo(
    () => pickMyBonusRow(report, employees, staff?.displayName),
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
          {thaiMonthYearLabel(report.year, report.month)} · {report.employeeCount} คน
        </span>
      </div>

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

      <BonusDeductionRulesTable report={report} />

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && myRow ? (
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
            อัปเดตทันทีเมื่อมีการกรอก OT / ผลิต / SmartCheck
          </p>
        </section>
      ) : null}

      {!loading && !myRow && staff?.displayName ? (
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

      {!loading && (isOwner || showAll) ? (
        <BonusTable report={report} highlightName={myRow?.workerName} />
      ) : null}

      <p className="muted bonus-footnote">
        ขาย = pool รวม ÷ จำนวนคน · ผลิต/OT จากยอดจริง · หักจาก SmartCheck ไม่ผ่าน ({BONUS_DEDUCTION_RULES[0].pctPerUnit}%/ครั้ง) และของเสีย ({BONUS_DEDUCTION_RULES[1].pctPerUnit}%/หน่วย)
      </p>
    </div>
  );
}

function BonusDeductionRulesTable({ report }: { report: MonthBonusReport }) {
  const counts = [
    report.deductionSummary.generalFailCount,
    report.deductionSummary.wasteQty,
  ];

  return (
    <div className="sheet-wrap bonus-deduct-wrap">
      <table className="sheet-table bonus-deduct-table">
        <thead>
          <tr>
            <th>รายการ</th>
            <th className="col-out">%</th>
            <th className="col-out">จำนวน</th>
          </tr>
        </thead>
        <tbody>
          {BONUS_DEDUCTION_RULES.map((rule, idx) => (
            <tr key={rule.id}>
              <td>{rule.label}</td>
              <td className="col-out">{fmtPct(rule.pctPerUnit)}</td>
              <td className="col-out">{counts[idx]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted bonus-deduct-note">
        สรุปหักโบนัสทั้งร้านในเดือนนี้ — หักรวม ฿{fmt(report.totalDeducted)}
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
    <div className="sheet-wrap bonus-sheet-wrap">
      <table className="sheet-table bonus-table">
        <thead>
          <tr>
            <th className="bonus-th-name">ชื่อ</th>
            <th className="col-out">ขาย</th>
            <th className="col-out">ผลิต</th>
            <th className="col-out">OT</th>
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
                <td
                  className="col-out bonus-th-deduct"
                  title={`ผิดพลาด ${row.generalFailCount} · ของเสีย ${fmt(row.wasteQty)}`}
                >
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
