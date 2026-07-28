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
  const [draftWithSales, setDraftWithSales] = useState(0);
  const [totals, setTotals] = useState<MonthSalesTotals | null>(null);
  const [currentIncome, setCurrentIncome] = useState(0);
  const [lastClose, setLastClose] = useState<VatMonthCloseAudit | null>(null);
  const [editIncome, setEditIncome] = useState("");
  const [vatInputTotal, setVatInputTotal] = useState(0);
  const [vatRegistered, setVatRegistered] = useState(false);

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
      setDraftWithSales(p.draftWithSales);
      setTotals(p.totals);
      setCurrentIncome(p.currentIncome);
      setLastClose(p.lastClose);
      setEditIncome(String(p.proposed || ""));
      setVatInputTotal(sumVatInput(inputs).vatInput);
      setVatRegistered(p.vatRegistered);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unconfirmed = Math.max(0, dayCount - confirmedDays);
  const netVat = roundMoney((totals?.vatOutput || 0) - vatInputTotal);

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
    const warn =
      unconfirmed > 0
        ? `\nยังมี ${unconfirmed} วันยังไม่ยืนยัน (ไม่นับในยอดนี้)`
        : "";
    const ok = window.confirm(
      `ใส่รายได้เดือน ${month} = ${formatPlainNumber(income)} บาท เข้าสรุปรายเดือน (P&L)?\n` +
        `จากวันยืนยัน ${confirmedDays} วัน · โหมด ${mode === "exVat" ? "ก่อน VAT" : "รวม VAT"}` +
        warn,
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
      <div className="vat-sales-toolbar vat-sales-toolbar--slim">
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
          รี
        </button>
      </div>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : (
        <>
          <p className="muted vat-sales-hint">
            นับเฉพาะวันยืนยัน · วันร่างไม่เข้า P&amp;L · Sp/Grab/LM อยู่หน้านี้เท่านั้น
          </p>
          <p className="vat-sales-hint">
            ยืนยัน <strong>{confirmedDays}</strong>/{dayCount}
            {unconfirmed > 0 ? (
              <span className="muted"> · ยังไม่ยืนยัน {unconfirmed}</span>
            ) : null}
            {draftWithSales > 0 ? (
              <span className="muted"> · มียอดยังไม่ยืนยัน {draftWithSales} วัน</span>
            ) : null}
            {" · "}
            โหมด <strong>{mode === "exVat" ? "ก่อน VAT" : "รวม VAT"}</strong>
          </p>
          {confirmedDays <= 0 ? (
            <p className="error-text">ยังไม่มีวันยืนยัน — ไปแท็บวันแล้วกดยืน</p>
          ) : null}
          {unconfirmed > 0 && confirmedDays > 0 ? (
            <p className="muted vat-sales-hint">
              ยังมีวันไม่ยืนยัน — ปิดได้ แต่ยอดเสนอไม่รวมวันเหล่านั้น
            </p>
          ) : null}

          {totals ? (
            <section className="vat-sales-summary vat-sales-summary--slim">
              <span>
                ส่ง <strong>{fmt(totals.deliveryGross)}</strong>
                <small className="muted">
                  {" "}
                  Sp {fmt(totals.shopee)} · G {fmt(totals.grab)} · LM {fmt(totals.lineman)}
                </small>
              </span>
              <span>
                ร้าน <strong>{fmt(totals.storefrontGross)}</strong>
              </span>
              <span className="vat-sales-summary-main">
                รวม <strong>{fmt(totals.totalGross)}</strong>
              </span>
              <span>
                ฐาน <strong>{fmt(totals.vatBase)}</strong>
              </span>
              <span>
                VAT <strong>{fmt(totals.vatOutput)}</strong>
              </span>
              <span className="muted">
                GP {fmt(totals.feeTotal)} · โอน {fmt(totals.netTransferTotal)}
              </span>
            </section>
          ) : null}

          <section className="vat-sales-settings vat-month-vat-box">
            <h2 className="vat-sales-section-title">VAT เดือน</h2>
            <p className="muted vat-sales-hint">
              {vatRegistered
                ? "จด VAT แล้ว — ตัวเลขจัดการภายใน (ยังไม่ยื่นอัตโนมัติ)"
                : "ยังไม่จด VAT — ใช้ประมาณการภายใน"}
            </p>
            <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-vat-table">
              <tbody>
                <tr>
                  <td>ขายรวม VAT</td>
                  <td className="col-num">{fmt(totals?.totalGross || 0)}</td>
                </tr>
                <tr>
                  <td>ฐาน</td>
                  <td className="col-num">{fmt(totals?.vatBase || 0)}</td>
                </tr>
                <tr>
                  <td>VAT ขาย</td>
                  <td className="col-num">{fmt(totals?.vatOutput || 0)}</td>
                </tr>
                <tr>
                  <td>ภาษีซื้อ</td>
                  <td className="col-num">{fmt(vatInputTotal)}</td>
                </tr>
                <tr>
                  <td>VAT สุทธิ</td>
                  <td className="col-num">
                    <strong>{fmt(netVat)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="vat-sales-settings vat-month-income-box">
            <h2 className="vat-sales-section-title">ใส่รายได้ → P&amp;L</h2>
            <p className="muted vat-sales-hint">
              แผงเดียวกันอยู่ที่สรุปรายเดือน (`/pnl/`) ด้วย · ในงบตอนนี้{" "}
              <strong>{fmt(currentIncome)}</strong> · เสนอ <strong>{fmt(proposed)}</strong>
            </p>
            <label className="vat-sales-field">
              ยอดที่จะใส่
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
                {busy === "month-close" ? "…" : "ใส่เป็นรายได้เดือนนี้"}
              </button>
              <Link href="/pnl/" className="ghost-btn vat-sales-act-btn">
                เปิดสรุปรายเดือน
              </Link>
            </div>
            {lastClose ? (
              <p className="muted vat-sales-hint">
                ปิดล่าสุด {formatDateTimeShort(lastClose.closedAt)} · {fmt(lastClose.income)} ·{" "}
                {lastClose.closedBy}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
