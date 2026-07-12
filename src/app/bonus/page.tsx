"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import {
  computeMonthBonus,
  monthInputValue,
  parseMonthInput,
  pickMyBonusRow,
  thaiMonthYearLabel,
  type MonthBonusReport,
} from "@/lib/bonus";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import { subscribeOtEntries, type OtEntry } from "@/lib/ot";
import { subscribeProdEntries, type ProdEntry } from "@/lib/production";
import { formatPlainNumber } from "@/lib/utils";

function fmt(n: number) {
  return formatPlainNumber(n);
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
    return () => {
      unsubOt();
      unsubProd();
    };
  }, [staff, canView]);

  const report = useMemo(() => {
    const { year, month: m } = parseMonthInput(month);
    return computeMonthBonus(otEntries, prodEntries, employees, year, m);
  }, [otEntries, prodEntries, employees, month]);

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
        <span>Pool ขาย ฿{fmt(report.totalSalesPool)}</span>
        <strong>รวม ฿{fmt(report.totalRemaining)}</strong>
      </div>

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
          </dl>
          <p className="muted bonus-live-note">อัปเดตทันทีเมื่อมีการกรอก OT / ผลิต</p>
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
        M1: ขาย = pool รวม ÷ จำนวนคน · ผลิต/OT จากยอดจริง · ยังไม่รวมตัด % (Phase 2)
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
            <td className="col-out bonus-th-final">
              <strong>฿{fmt(report.totalRemaining)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
