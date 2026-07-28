"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDateTimeShort, formatPlainNumber } from "@/lib/utils";
import {
  buildMonthClosePreview,
  closeVatMonthToIncome,
  type VatMonthCloseAudit,
} from "@/lib/vat-sales-close";
import { listVatInputInvoices, sumVatInput } from "@/lib/vat-input";
import { roundMoney, type MonthSalesTotals, type PnlIncomeMode } from "@/lib/vat-sales";

function fmt(n: number) {
  if (!n) return "—";
  return formatPlainNumber(n);
}

type Props = {
  month: string;
  onMonthChange: (m: string) => void;
  actor: string;
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string) => void;
  setMsg: (v: string) => void;
};

export function VatSalesMonthClosePanel({
  month,
  onMonthChange,
  actor,
  busy,
  setBusy,
  setError,
  setMsg,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<PnlIncomeMode>("exVat");
  const [proposed, setProposed] = useState(0);
  const [confirmedDays, setConfirmedDays] = useState(0);
  const [dayCount, setDayCount] = useState(0);
  const [totals, setTotals] = useState<MonthSalesTotals | null>(null);
  const [currentIncome, setCurrentIncome] = useState(0);
  const [lastClose, setLastClose] = useState<VatMonthCloseAudit | null>(null);
  const [editIncome, setEditIncome] = useState("");
  const [vatInputTotal, setVatInputTotal] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, inputs] = await Promise.all([
        buildMonthClosePreview(month),
        listVatInputInvoices(month).catch(() => []),
      ]);
      setMode(p.mode);
      setProposed(p.proposed);
      setConfirmedDays(p.confirmedDays);
      setDayCount(p.dayCount);
      setTotals(p.totals);
      setCurrentIncome(p.currentIncome);
      setLastClose(p.lastClose);
      setEditIncome(String(p.proposed || ""));
      setVatInputTotal(sumVatInput(inputs).vatInput);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeMonth = async () => {
    const income = Number(String(editIncome).replace(/,/g, ""));
    if (!Number.isFinite(income) || income < 0) {
      setError("ยอดรายได้ไม่ถูกต้อง");
      return;
    }
    if (confirmedDays <= 0) {
      setError("ยังไม่มีวันที่ยืนยัน — ยืนยันรายวันก่อนปิดเดือน");
      return;
    }
    const ok = window.confirm(
      `ใส่รายได้เดือน ${month} = ${formatPlainNumber(income)} บาท เข้าสรุปรายเดือน (P&L)?\n` +
        `จากวันยืนยัน ${confirmedDays} วัน · โหมด ${mode === "exVat" ? "ก่อน VAT" : "รวม VAT"}`,
    );
    if (!ok) return;
    setBusy("month-close");
    setError("");
    setMsg("");
    try {
      const audit = await closeVatMonthToIncome(month, actor, { forceIncome: income });
      setMsg(`ปิดเดือน ${month} แล้ว · รายได้ ${formatPlainNumber(audit.income)}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vat-month-close">
      <div className="vat-sales-toolbar" style={{ marginBottom: "0.85rem" }}>
        <label className="vat-sales-month">
          เดือน
          <input
            type="month"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ghost-btn"
          disabled={busy !== null || loading}
          onClick={() => void refresh()}
        >
          รีเฟรช
        </button>
      </div>

      {loading ? (
        <p className="muted">กำลังโหลดสรุปเดือน...</p>
      ) : (
        <>
          <section className="vat-sales-settings">
            <h2 className="vat-sales-section-title">สรุปจากวันที่ยืนยันแล้ว</h2>
            <p className="muted vat-sales-hint">
              นับเฉพาะวันสถานะยืนยัน · วันร่างไม่เข้า P&amp;L · รายละเอียดช่องทางอยู่หน้านี้เท่านั้น
              (หน้าสรุปรายเดือนเห็นแค่ยอดรวม)
            </p>
            <p>
              วันยืนยัน <strong>{confirmedDays}</strong> / {dayCount} วันในเดือน · โหมดรายได้:{" "}
              <strong>{mode === "exVat" ? "ก่อน VAT (แนะนำ)" : "รวม VAT"}</strong>
            </p>
            {confirmedDays <= 0 ? (
              <p className="error-text">ยังไม่มีวันยืนยัน — ไปแท็บตารางรายวันแล้วกดยืนยันทีละวัน</p>
            ) : null}
          </section>

          {totals ? (
            <section className="vat-sales-summary">
              <div className="vat-sales-summary-card">
                <span className="muted">เดลิเวอรี่</span>
                <strong>{fmt(totals.deliveryGross)}</strong>
                <small className="muted">
                  Shopee {fmt(totals.shopee)} · Grab {fmt(totals.grab)} · LINE MAN{" "}
                  {fmt(totals.lineman)}
                </small>
              </div>
              <div className="vat-sales-summary-card">
                <span className="muted">หน้าร้าน</span>
                <strong>{fmt(totals.storefrontGross)}</strong>
              </div>
              <div className="vat-sales-summary-card vat-sales-summary-main">
                <span className="muted">ยอดขายร้าน (รวม VAT)</span>
                <strong>{fmt(totals.totalGross)}</strong>
              </div>
              <div className="vat-sales-summary-card">
                <span className="muted">ฐานภาษี</span>
                <strong>{fmt(totals.vatBase)}</strong>
              </div>
              <div className="vat-sales-summary-card">
                <span className="muted">VAT 7%</span>
                <strong>{fmt(totals.vatOutput)}</strong>
              </div>
              <div className="vat-sales-summary-card">
                <span className="muted">ค่าธรรมเนียมรวม</span>
                <strong>{fmt(totals.feeTotal)}</strong>
              </div>
              <div className="vat-sales-summary-card">
                <span className="muted">ยอดโอนสุทธิรวม</span>
                <strong>{fmt(totals.netTransferTotal)}</strong>
              </div>
            </section>
          ) : null}

          <section className="vat-sales-settings">
            <h2 className="vat-sales-section-title">รายงาน VAT รายเดือน</h2>
            <p className="muted">
              ใช้จัดการภายใน / ประมาณการ — ไม่ใช่แบบฟอร์มยื่นอัตโนมัติ
            </p>
            <table className="sheet-table vat-sales-table" style={{ minWidth: 0 }}>
              <tbody>
                <tr>
                  <td>ยอดขายรวม VAT</td>
                  <td className="col-num">{fmt(totals?.totalGross || 0)}</td>
                </tr>
                <tr>
                  <td>ฐานภาษี</td>
                  <td className="col-num">{fmt(totals?.vatBase || 0)}</td>
                </tr>
                <tr>
                  <td>VAT 7% (ขาย)</td>
                  <td className="col-num">{fmt(totals?.vatOutput || 0)}</td>
                </tr>
                <tr>
                  <td>ภาษีซื้อ (ใบกำกับ)</td>
                  <td className="col-num">{fmt(vatInputTotal)}</td>
                </tr>
                <tr>
                  <td>VAT สุทธิ (ขาย − ซื้อ)</td>
                  <td className="col-num">
                    {fmt(roundMoney((totals?.vatOutput || 0) - vatInputTotal))}
                  </td>
                </tr>
                <tr>
                  <td>เดลิเวอรี่</td>
                  <td className="col-num">{fmt(totals?.deliveryGross || 0)}</td>
                </tr>
                <tr>
                  <td>หน้าร้าน</td>
                  <td className="col-num">{fmt(totals?.storefrontGross || 0)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="vat-sales-settings">
            <h2 className="vat-sales-section-title">ใส่เป็นรายได้เดือนนี้ (P&amp;L)</h2>
            <p className="muted">
              ค่าปัจจุบันในสรุปรายเดือน: <strong>{fmt(currentIncome)}</strong> · ค่าเสนอ:{" "}
              <strong>{fmt(proposed)}</strong>
            </p>
            <label className="vat-sales-field">
              ยอดที่จะใส่ (แก้ได้ก่อนยืนยัน)
              <input
                inputMode="decimal"
                value={editIncome}
                onChange={(e) => setEditIncome(e.target.value)}
              />
            </label>
            <div className="vat-sales-acts">
              <button
                type="button"
                className="primary-btn"
                disabled={busy !== null || confirmedDays <= 0}
                onClick={() => void closeMonth()}
              >
                {busy === "month-close" ? "กำลังบันทึก..." : "ใส่เป็นรายได้เดือนนี้"}
              </button>
              <Link href="/pnl/" className="ghost-btn vat-sales-act-btn">
                เปิดสรุปรายเดือน
              </Link>
            </div>
            {lastClose ? (
              <p className="muted">
                ปิดล่าสุด {formatDateTimeShort(lastClose.closedAt)} โดย {lastClose.closedBy} · ยอด{" "}
                {fmt(lastClose.income)}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
