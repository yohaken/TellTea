"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  loadPnlReport,
  saveMonthlyIncome,
  type MonthCategoryRow,
  type PnlMonthRow,
  type PnlReportData,
} from "@/lib/pnl";
import { formatPlainNumber } from "@/lib/utils";

export default function PnlPage() {
  return (
    <AuthGate>
      <PnlView />
    </AuthGate>
  );
}

function fmt(n: number) {
  if (!n) return "";
  return formatPlainNumber(n);
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(1)}%`;
}

function CategoryTable({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: MonthCategoryRow[];
  tone: "staff" | "owner" | "combined";
}) {
  return (
    <div className={`pnl-block pnl-${tone}`}>
      <h3 className="pnl-block-title">{title}</h3>
      <div className="sheet-wrap">
        <table className="sheet-table pnl-table">
          <thead>
            <tr>
              <th>เดือน</th>
              <th className="col-num">Asset</th>
              <th className="col-num">cogs</th>
              <th className="col-num">sga</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  ยังไม่มีข้อมูล
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.month}>
                  <td className="col-date">{r.month}</td>
                  <td className="col-num">{fmt(r.asset)}</td>
                  <td className="col-num">{fmt(r.cogs)}</td>
                  <td className="col-num">{fmt(r.sga)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PnlView() {
  const { user, staff } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<PnlReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState<string | null>(null);
  const [draftIncome, setDraftIncome] = useState<Record<string, string>>({});

  useEffect(() => {
    if (staff && !can(staff, "pnl")) router.replace("/ledger/");
  }, [staff, router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const report = await loadPnlReport();
      setData(report);
      const draft: Record<string, string> = {};
      for (const row of report.combined) {
        const v = report.incomeByMonth[row.month];
        draft[row.month] = v ? String(v) : "";
      }
      setDraftIncome(draft);
    } catch (err) {
      setError((err as Error).message || "โหลดสรุปไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (can(staff, "pnl")) void refresh();
  }, [staff, refresh]);

  if (!can(staff, "pnl")) return null;

  async function onSaveIncome(month: string) {
    if (!user?.email) return;
    setSavingMonth(month);
    setError(null);
    try {
      const raw = draftIncome[month] ?? "";
      const value = raw.trim() === "" ? 0 : Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(value)) throw new Error("ตัวเลขไม่ถูกต้อง");
      await saveMonthlyIncome(month, value, user.email);
      await refresh();
    } catch (err) {
      setError((err as Error).message || "บันทึกรายได้ไม่สำเร็จ");
    } finally {
      setSavingMonth(null);
    }
  }

  return (
    <div className="pnl-page">
      <h1 className="panel-title">สรุปรายเดือน</h1>
      <p className="muted" style={{ marginBottom: "0.85rem", textAlign: "left" }}>
        มุมมองเจ้าของ — แยกบช. → รวม → กำไรขาดทุน · income กรอกเอง
      </p>

      <div className="btn-row" style={{ marginBottom: "0.75rem" }}>
        <button type="button" className="ghost-btn" disabled={loading} onClick={() => void refresh()}>
          {loading ? "กำลังโหลด..." : "รีเฟรช"}
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading && !data ? <p className="empty">กำลังโหลดสรุป...</p> : null}

      {data ? (
        <>
          <section className="pnl-section">
            <h2 className="pnl-section-title">1) แยกแหล่ง</h2>
            <div className="pnl-split">
              <CategoryTable title="บช. พนง." rows={data.staff} tone="staff" />
              <CategoryTable title="บช. เจ้าของ" rows={data.owner} tone="owner" />
            </div>
          </section>

          <section className="pnl-section">
            <h2 className="pnl-section-title">2) รวม พนง. + เจ้าของ</h2>
            <CategoryTable title="พนง. + เจ้าของ" rows={data.combined} tone="combined" />
          </section>

          <section className="pnl-section">
            <h2 className="pnl-section-title">3) สรุปกำไร–ขาดทุน</h2>
            <p className="muted" style={{ marginBottom: "0.55rem", textAlign: "left", fontSize: "0.85rem" }}>
              กรอก income แล้วกดบันทึกทีละเดือน — คำนวณอัตโนมัติจากยอดรวมขั้น 2
            </p>
            <div className="sheet-wrap pnl-scroll">
              <table className="sheet-table pnl-table pnl-wide">
                <thead>
                  <tr>
                    <th>เดือน</th>
                    <th className="col-num">income</th>
                    <th className="col-num">/วัน</th>
                    <th className="col-num">cogs</th>
                    <th className="col-num">cogs%</th>
                    <th className="col-num">gross</th>
                    <th className="col-num">%gross</th>
                    <th className="col-num">sga</th>
                    <th className="col-num">sga%</th>
                    <th className="col-num">net</th>
                    <th className="col-num">%net</th>
                    <th className="col-num">Asset</th>
                    <th className="col-num">invest/net</th>
                    <th className="col-num">Cash+</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.pnl.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="empty">
                        ยังไม่มีเดือนให้สรุป
                      </td>
                    </tr>
                  ) : (
                    data.pnl.map((row: PnlMonthRow) => (
                      <tr key={row.month}>
                        <td className="col-date">{row.month}</td>
                        <td className="col-num pnl-income-cell">
                          <input
                            className="pnl-income-input"
                            inputMode="decimal"
                            value={draftIncome[row.month] ?? ""}
                            onChange={(e) =>
                              setDraftIncome((prev) => ({
                                ...prev,
                                [row.month]: e.target.value,
                              }))
                            }
                            placeholder="0"
                            disabled={savingMonth === row.month}
                          />
                        </td>
                        <td className="col-num">{fmt(row.incomePerDay)}</td>
                        <td className="col-num">{fmt(row.cogs)}</td>
                        <td className="col-num">{fmtPct(row.cogsPct)}</td>
                        <td className="col-num">{fmt(row.gross)}</td>
                        <td className="col-num">{fmtPct(row.grossPct)}</td>
                        <td className="col-num">{fmt(row.sga)}</td>
                        <td className="col-num">{fmtPct(row.sgaPct)}</td>
                        <td className="col-num">{fmt(row.net)}</td>
                        <td className="col-num">{fmtPct(row.netPct)}</td>
                        <td className="col-num">{fmt(row.asset)}</td>
                        <td className="col-num">{fmtPct(row.investOverNet)}</td>
                        <td className="col-num">{fmt(row.cashPlus)}</td>
                        <td>
                          <button
                            type="button"
                            className="sheet-edit"
                            disabled={savingMonth === row.month}
                            onClick={() => void onSaveIncome(row.month)}
                          >
                            {savingMonth === row.month ? "..." : "บันทึก"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
