"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { OwnerBooksModeSwitch } from "@/components/OwnerBooksModeSwitch";
import { PnlVatIncomePanel } from "@/components/vat-sales/PnlVatIncomePanel";
import { PnlTrendChart } from "@/components/PnlTrendChart";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  averageCategoryRows,
  averagePnlRows,
  completePnlMonths,
  filterCategoryRowsByMonths,
  filterPnlRowsByMonths,
  loadPnlReport,
  purchaseVatTotal,
  saveMonthlyIncome,
  sumCategoryRows,
  summarizePnlRows,
  type MonthCategoryRow,
  type PnlIncomeSource,
  type PnlMonthRow,
  type PnlReportData,
} from "@/lib/pnl";
import { exportPnlXlsx } from "@/lib/xlsx-export";
import { categoryLabel } from "@/lib/categories";
import { formatPlainNumber } from "@/lib/utils";
import {
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
} from "@/lib/vat-number-format";

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

const INCOME_SOURCE_TITLE: Record<PnlIncomeSource, string> = {
  vat: "ดึงจากหน้า VAT อัตโนมัติ",
  manual: "พิมพ์ทับเอง — ไม่ตามหน้า VAT",
  stored: "ค่าที่บันทึกไว้เดิม (เดือนนี้ไม่มีข้อมูลหน้า VAT)",
  none: "ยังไม่มีรายได้",
};

/** แถวตารางเรียงเดือนใหม่ → เก่า (ข้อมูล/กราฟ/ส่งออกยังเรียงเก่า → ใหม่) */
function newestFirst<T extends { month: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.month.localeCompare(a.month));
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(1)}%`;
}

function CategoryTable({
  title,
  rows,
  tone,
  showTotals,
}: {
  title: string;
  rows: MonthCategoryRow[];
  tone: "staff" | "owner" | "combined";
  showTotals: boolean;
}) {
  const totals = showTotals && rows.length ? sumCategoryRows(rows) : null;
  const averages = showTotals && rows.length ? averageCategoryRows(rows) : null;

  return (
    <div className={`pnl-block pnl-${tone}`}>
      <h3 className="pnl-block-title">{title}</h3>
      <p className="pnl-mini-hint pnl-cat-vat-hint">
        ต้นทุน/คชจ./สินทรัพย์ = หลังหัก VAT · คอลัมน์ภาษี = ภาษีซื้อของหมวดนั้น
      </p>
      <div className="sheet-wrap sheet-bleed">
        <table className="sheet-table pnl-table pnl-cat-vat-table sheet-table--dense">
          <thead>
            <tr>
              <th>เดือน</th>
              <th className="col-num">{categoryLabel("cogs")}</th>
              <th className="col-num" title="ภาษีซื้อของต้นทุน/วัตถุดิบ">
                ภาษีต้นทุน
              </th>
              <th className="col-num">{categoryLabel("sga")}</th>
              <th className="col-num" title="ภาษีซื้อของค่าใช้จ่าย">
                ภาษีคชจ.
              </th>
              <th className="col-num">{categoryLabel("asset")}</th>
              <th className="col-num" title="ภาษีซื้อของสินทรัพย์">
                ภาษีสท.
              </th>
              <th className="col-num" title="รวมภาษีซื้อ">
                รวมภาษีซื้อ
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">
                  ยังไม่มีข้อมูล
                </td>
              </tr>
            ) : (
              newestFirst(rows).map((r) => (
                <tr key={r.month}>
                  <td className="col-date">{r.month}</td>
                  <td className="col-num">{fmt(r.cogs)}</td>
                  <td className="col-num pnl-vat-cell">{fmt(r.vatCogs)}</td>
                  <td className="col-num">{fmt(r.sga)}</td>
                  <td className="col-num pnl-vat-cell">{fmt(r.vatSga)}</td>
                  <td className="col-num">{fmt(r.asset)}</td>
                  <td className="col-num pnl-vat-cell">{fmt(r.vatAsset)}</td>
                  <td className="col-num pnl-vat-cell">{fmt(purchaseVatTotal(r))}</td>
                </tr>
              ))
            )}
          </tbody>
          {totals && averages ? (
            <tfoot>
              <tr className="pnl-totals-row">
                <td className="col-date">รวม</td>
                <td className="col-num">{fmt(totals.cogs)}</td>
                <td className="col-num pnl-vat-cell">{fmt(totals.vatCogs)}</td>
                <td className="col-num">{fmt(totals.sga)}</td>
                <td className="col-num pnl-vat-cell">{fmt(totals.vatSga)}</td>
                <td className="col-num">{fmt(totals.asset)}</td>
                <td className="col-num pnl-vat-cell">{fmt(totals.vatAsset)}</td>
                <td className="col-num pnl-vat-cell">{fmt(purchaseVatTotal(totals))}</td>
              </tr>
              <tr className="pnl-averages-row">
                <td className="col-date">เฉลี่ย</td>
                <td className="col-num">{fmt(averages.cogs)}</td>
                <td className="col-num pnl-vat-cell">{fmt(averages.vatCogs)}</td>
                <td className="col-num">{fmt(averages.sga)}</td>
                <td className="col-num pnl-vat-cell">{fmt(averages.vatSga)}</td>
                <td className="col-num">{fmt(averages.asset)}</td>
                <td className="col-num pnl-vat-cell">{fmt(averages.vatAsset)}</td>
                <td className="col-num pnl-vat-cell">{fmt(purchaseVatTotal(averages))}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function PnlView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<PnlReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState<string | null>(null);
  const [draftIncome, setDraftIncome] = useState<Record<string, string>>({});
  const [summaryMode, setSummaryMode] = useState(false);
  const [exporting, setExporting] = useState(false);

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
      for (const row of report.pnl) {
        draft[row.month] = moneyFieldValue(report.incomeByMonth[row.month] || 0);
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

  const completeMonths = useMemo(() => {
    if (!data) return [] as string[];
    return completePnlMonths(data.pnl, data.incomeByMonth);
  }, [data]);

  const viewStaff = useMemo(() => {
    if (!data) return [];
    return summaryMode
      ? filterCategoryRowsByMonths(data.staff, completeMonths)
      : data.staff;
  }, [data, summaryMode, completeMonths]);

  const viewOwner = useMemo(() => {
    if (!data) return [];
    return summaryMode
      ? filterCategoryRowsByMonths(data.owner, completeMonths)
      : data.owner;
  }, [data, summaryMode, completeMonths]);

  const viewCombined = useMemo(() => {
    if (!data) return [];
    return summaryMode
      ? filterCategoryRowsByMonths(data.combined, completeMonths)
      : data.combined;
  }, [data, summaryMode, completeMonths]);

  const viewPnl = useMemo(() => {
    if (!data) return [] as PnlMonthRow[];
    return summaryMode ? filterPnlRowsByMonths(data.pnl, completeMonths) : data.pnl;
  }, [data, summaryMode, completeMonths]);

  const pnlTotals = useMemo(
    () => (summaryMode ? summarizePnlRows(viewPnl) : null),
    [summaryMode, viewPnl],
  );
  const pnlAverages = useMemo(
    () => (summaryMode ? averagePnlRows(viewPnl) : null),
    [summaryMode, viewPnl],
  );

  if (!can(staff, "pnl")) return null;

  const isOwner = staff?.role === "owner";
  async function onSaveIncome(month: string) {
    if (!actorId) return;
    setSavingMonth(month);
    setError(null);
    try {
      const raw = draftIncome[month] ?? "";
      const cleaned = raw.replace(/[,\s]/g, "");
      if (cleaned !== "" && !Number.isFinite(Number(cleaned))) {
        throw new Error("ตัวเลขไม่ถูกต้อง");
      }
      if (Number(cleaned) < 0) throw new Error("รายได้ต้องไม่ติดลบ");
      const value = parseVatMoneyInput(raw);
      await saveMonthlyIncome(month, value, actorId, { manual: true });
      await refresh();
    } catch (err) {
      setError((err as Error).message || "บันทึกรายได้ไม่สำเร็จ");
    } finally {
      setSavingMonth(null);
    }
  }

  async function onResetIncome(month: string) {
    const vat = data?.vatByMonth[month];
    if (!actorId || !vat) return;
    setSavingMonth(month);
    setError(null);
    try {
      await saveMonthlyIncome(month, vat.income, actorId, { manual: false });
      await refresh();
    } catch (err) {
      setError((err as Error).message || "คืนค่ารายได้ไม่สำเร็จ");
    } finally {
      setSavingMonth(null);
    }
  }

  async function onExportTables() {
    if (!data) return;
    setExporting(true);
    setError(null);
    try {
      exportPnlXlsx(
        {
          ...data,
          staff: viewStaff,
          owner: viewOwner,
          combined: viewCombined,
          pnl: viewPnl,
        },
        {
          summaryMode,
          includeTotals: summaryMode,
          includeVat: isOwner,
        },
      );
    } catch (err) {
      setError((err as Error).message || "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="pnl-page pnl-mini owner-books-page">
      {isOwner ? <OwnerBooksModeSwitch active="pnl" /> : null}
      <h1 className="panel-title pnl-mini-title">สรุปรายเดือน</h1>
      <p className="pnl-mini-intro">
        {isOwner
          ? "แยกบช. → รวม → กำไรขาดทุน · รายได้ดึงจากหน้า VAT อัตโนมัติ (พิมพ์ทับได้) · ต้นทุนกับภาษีซื้อแยกคอลัมน์"
          : "แยกบช. → รวม → กำไรขาดทุน · ต้นทุนกับภาษีซื้อแยกคอลัมน์ · income กรอกเอง"}
      </p>

      {isOwner ? (
        <PnlVatIncomePanel />
      ) : null}

      <div className="pnl-toolbar">
        <label className="pnl-summary-toggle">
          <input
            type="checkbox"
            checked={summaryMode}
            onChange={(e) => setSummaryMode(e.target.checked)}
          />
          <span>
            โหมดสรุป
            <span className="muted">
              {summaryMode
                ? ` · ${completeMonths.length} เดือนที่มีรายได้`
                : " · เฉพาะเดือนที่มีรายได้"}
            </span>
          </span>
        </label>
        <button
          type="button"
          className="npos-slim-text-btn"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "กำลังโหลด…" : "รีเฟรช"}
        </button>
        <button
          type="button"
          className="npos-slim-text-btn is-active"
          disabled={!data || exporting}
          onClick={() => void onExportTables()}
        >
          {exporting ? "กำลังส่งออก…" : "ส่งออก Excel"}
        </button>
      </div>
      {summaryMode && completeMonths.length === 0 ? (
        <p className="pnl-mini-hint pnl-summary-empty-hint">
          ยังไม่มีเดือนที่มีรายได้ — กรอกยอดโอนที่หน้า VAT หรือพิมพ์ในตารางกำไร–ขาดทุน
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {loading && !data ? <p className="empty">กำลังโหลดสรุป...</p> : null}

      {data ? (
        <>
          <section className="pnl-section">
            <h2 className="pnl-section-title">สรุปกำไร–ขาดทุน</h2>
            <p className="pnl-mini-hint">
              {isOwner
                ? "รายได้ = ยอดโอนถึงร้านจากหน้า VAT (ทุกเดือนที่บันทึกไว้) · พิมพ์ทับแล้วกดบันทึก = ล็อกค่าเอง (สีส้ม) · ↺ คืนยอดจาก VAT · ต้นทุน/คชจ.ไม่รวมภาษีซื้อ"
                : "กรอก income แล้วกดบันทึกทีละเดือน — โหมดสรุปตัดเดือนที่ยังไม่มีรายได้ออกจากทุกตาราง"}
            </p>
            <PnlTrendChart rows={viewPnl} isOwner={isOwner} />
            <div className="sheet-wrap pnl-scroll sheet-bleed">
              <table className="sheet-table pnl-table pnl-wide sheet-table--dense">
                <thead>
                  <tr>
                    <th>เดือน</th>
                    <th className="col-num">รายได้</th>
                    <th className="col-num">/วัน</th>
                    <th className="col-num">{categoryLabel("cogs")}</th>
                    <th className="col-num">%</th>
                    <th className="col-num" title="ภาษีซื้อวัตถุดิบ/ต้นทุน">
                      ภาษีต้นทุน
                    </th>
                    <th className="col-num">กำไรขั้นต้น</th>
                    <th className="col-num">%</th>
                    <th className="col-num">{categoryLabel("sga")}</th>
                    <th className="col-num">%</th>
                    <th className="col-num" title="ภาษีซื้อค่าใช้จ่าย">
                      ภาษีคชจ.
                    </th>
                    <th className="col-num">สุทธิ</th>
                    <th className="col-num">%</th>
                    {isOwner ? (
                      <>
                        <th className="col-num" title="ภาษีขายจากหน้า VAT รายเดือน">
                          ภาษีขาย
                        </th>
                        <th
                          className="col-num"
                          title="ภาษีขาย − ภาษีซื้อที่นำมาหัก (หน้า VAT) · ติดลบ = ได้คืน"
                        >
                          VAT สุทธิ
                        </th>
                        <th className="col-num" title="สุทธิ − VAT สุทธิ">
                          หลัง VAT
                        </th>
                      </>
                    ) : null}
                    <th className="col-num">{categoryLabel("asset")}</th>
                    <th className="col-num" title="ภาษีซื้อสินทรัพย์">
                      ภาษีสท.
                    </th>
                    <th className="col-num" title="รวมภาษีซื้อ — ไม่หักซ้ำในกำไร">
                      รวมภาษีซื้อ
                    </th>
                    <th className="col-num">invest/net</th>
                    <th className="col-num">Cash+</th>
                    <th className="col-num">เงินสด/รายได้</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {viewPnl.length === 0 ? (
                    <tr>
                      <td colSpan={isOwner ? 23 : 20} className="empty">
                        {summaryMode
                          ? "ไม่มีเดือนที่มีรายได้ให้สรุป"
                          : "ยังไม่มีเดือนให้สรุป"}
                      </td>
                    </tr>
                  ) : (
                    newestFirst(viewPnl).map((row: PnlMonthRow) => {
                      const vatIncome = data.vatByMonth[row.month]?.income;
                      const canReset =
                        row.incomeSource === "manual" &&
                        vatIncome != null &&
                        Math.abs(vatIncome - row.income) > 0.004;
                      return (
                      <tr key={row.month}>
                        <td className="col-date">{row.month}</td>
                        <td className="col-num pnl-income-cell">
                          <input
                            className={`pnl-income-input is-src-${row.incomeSource}`}
                            title={INCOME_SOURCE_TITLE[row.incomeSource]}
                            inputMode="decimal"
                            value={draftIncome[row.month] ?? ""}
                            onChange={(e) =>
                              setDraftIncome((prev) => ({
                                ...prev,
                                [row.month]: e.target.value,
                              }))
                            }
                            onBlur={(e) => {
                              const text = normalizeMoneyFieldText(e.target.value);
                              setDraftIncome((prev) => ({ ...prev, [row.month]: text }));
                            }}
                            placeholder="0.00"
                            disabled={savingMonth === row.month}
                          />
                        </td>
                        <td className="col-num">{fmt(row.incomePerDay)}</td>
                        <td className="col-num">{fmt(row.cogs)}</td>
                        <td className="col-num">{fmtPct(row.cogsPct)}</td>
                        <td className="col-num pnl-vat-cell">{fmt(row.vatCogs)}</td>
                        <td className="col-num">{fmt(row.gross)}</td>
                        <td className="col-num">{fmtPct(row.grossPct)}</td>
                        <td className="col-num">{fmt(row.sga)}</td>
                        <td className="col-num">{fmtPct(row.sgaPct)}</td>
                        <td className="col-num pnl-vat-cell">{fmt(row.vatSga)}</td>
                        <td className="col-num">{fmt(row.net)}</td>
                        <td className="col-num">{fmtPct(row.netPct)}</td>
                        {isOwner ? (
                          <>
                            <td className="col-num">{fmt(row.outputVat)}</td>
                            <td className="col-num">{fmt(row.netVat)}</td>
                            <td className="col-num">
                              {row.outputVat || row.netVat ? fmt(row.profitAfterVat) : ""}
                            </td>
                          </>
                        ) : null}
                        <td className="col-num">{fmt(row.asset)}</td>
                        <td className="col-num pnl-vat-cell">{fmt(row.vatAsset)}</td>
                        <td className="col-num pnl-vat-cell">{fmt(row.purchaseVat)}</td>
                        <td className="col-num">{fmtPct(row.investOverNet)}</td>
                        <td className="col-num">{fmt(row.cashPlus)}</td>
                        <td className="col-num">{fmtPct(row.cashOverIncome)}</td>
                        <td className="pnl-income-actions">
                          <button
                            type="button"
                            className="sheet-edit"
                            disabled={savingMonth === row.month}
                            onClick={() => void onSaveIncome(row.month)}
                          >
                            {savingMonth === row.month ? "..." : "บันทึก"}
                          </button>
                          {canReset ? (
                            <button
                              type="button"
                              className="sheet-edit"
                              title={`คืนยอดจากหน้า VAT ${fmt(vatIncome)}`}
                              disabled={savingMonth === row.month}
                              onClick={() => void onResetIncome(row.month)}
                            >
                              ↺
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
                {pnlTotals && pnlAverages ? (
                  <tfoot>
                    <tr className="pnl-totals-row">
                      <td className="col-date">รวม</td>
                      <td className="col-num">{fmt(pnlTotals.income)}</td>
                      <td className="col-num">{fmt(pnlTotals.incomePerDay)}</td>
                      <td className="col-num">{fmt(pnlTotals.cogs)}</td>
                      <td className="col-num">{fmtPct(pnlTotals.cogsPct)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlTotals.vatCogs)}</td>
                      <td className="col-num">{fmt(pnlTotals.gross)}</td>
                      <td className="col-num">{fmtPct(pnlTotals.grossPct)}</td>
                      <td className="col-num">{fmt(pnlTotals.sga)}</td>
                      <td className="col-num">{fmtPct(pnlTotals.sgaPct)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlTotals.vatSga)}</td>
                      <td className="col-num">{fmt(pnlTotals.net)}</td>
                      <td className="col-num">{fmtPct(pnlTotals.netPct)}</td>
                      {isOwner ? (
                        <>
                          <td className="col-num">{fmt(pnlTotals.outputVat)}</td>
                          <td className="col-num">{fmt(pnlTotals.netVat)}</td>
                          <td className="col-num">{fmt(pnlTotals.profitAfterVat)}</td>
                        </>
                      ) : null}
                      <td className="col-num">{fmt(pnlTotals.asset)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlTotals.vatAsset)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlTotals.purchaseVat)}</td>
                      <td className="col-num">{fmtPct(pnlTotals.investOverNet)}</td>
                      <td className="col-num">{fmt(pnlTotals.cashPlus)}</td>
                      <td className="col-num">{fmtPct(pnlTotals.cashOverIncome)}</td>
                      <td />
                    </tr>
                    <tr className="pnl-averages-row">
                      <td className="col-date">เฉลี่ย</td>
                      <td className="col-num">{fmt(pnlAverages.income)}</td>
                      <td className="col-num">{fmt(pnlAverages.incomePerDay)}</td>
                      <td className="col-num">{fmt(pnlAverages.cogs)}</td>
                      <td className="col-num">{fmtPct(pnlAverages.cogsPct)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlAverages.vatCogs)}</td>
                      <td className="col-num">{fmt(pnlAverages.gross)}</td>
                      <td className="col-num">{fmtPct(pnlAverages.grossPct)}</td>
                      <td className="col-num">{fmt(pnlAverages.sga)}</td>
                      <td className="col-num">{fmtPct(pnlAverages.sgaPct)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlAverages.vatSga)}</td>
                      <td className="col-num">{fmt(pnlAverages.net)}</td>
                      <td className="col-num">{fmtPct(pnlAverages.netPct)}</td>
                      {isOwner ? (
                        <>
                          <td className="col-num">{fmt(pnlAverages.outputVat)}</td>
                          <td className="col-num">{fmt(pnlAverages.netVat)}</td>
                          <td className="col-num">{fmt(pnlAverages.profitAfterVat)}</td>
                        </>
                      ) : null}
                      <td className="col-num">{fmt(pnlAverages.asset)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlAverages.vatAsset)}</td>
                      <td className="col-num pnl-vat-cell">{fmt(pnlAverages.purchaseVat)}</td>
                      <td className="col-num">{fmtPct(pnlAverages.investOverNet)}</td>
                      <td className="col-num">{fmt(pnlAverages.cashPlus)}</td>
                      <td className="col-num">{fmtPct(pnlAverages.cashOverIncome)}</td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {summaryMode ? (
              <p className="pnl-mini-hint pnl-totals-legend">
                รวม = ยอดเงินรวม · % ถ่วงรายได้ · /วัน จากยอดรวม÷วันรวม · เฉลี่ย = Σ ÷ จำนวนเดือนที่แสดง
              </p>
            ) : null}
          </section>

          <section className="pnl-section">
            <h2 className="pnl-section-title">แยกแหล่ง</h2>
            <div className="pnl-split">
              <CategoryTable
                title="บช. พนง."
                rows={viewStaff}
                tone="staff"
                showTotals={summaryMode}
              />
              <CategoryTable
                title="บช. เจ้าของ"
                rows={viewOwner}
                tone="owner"
                showTotals={summaryMode}
              />
            </div>
          </section>

          <section className="pnl-section">
            <h2 className="pnl-section-title">รวม พนง. + เจ้าของ</h2>
            <CategoryTable
              title="พนง. + เจ้าของ"
              rows={viewCombined}
              tone="combined"
              showTotals={summaryMode}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
