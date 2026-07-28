"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPlainNumber } from "@/lib/utils";
import {
  bangkokMonthKey,
  roundMoney,
  type MonthSalesTotals,
  type PnlIncomeMode,
} from "@/lib/vat-sales";
import {
  buildMonthClosePreview,
  closeVatMonthToIncome,
} from "@/lib/vat-sales-close";
import { listVatInputInvoices, sumVatInput } from "@/lib/vat-input";

function fmt(n: number) {
  if (!n) return "—";
  return formatPlainNumber(n);
}

type Props = {
  actor: string;
  onIncomeApplied?: () => void;
};

/** แผงปิดเดือน VAT บนหน้าสรุปรายเดือน — เฉพาะเจ้าของ */
export function PnlVatIncomePanel({ actor, onIncomeApplied }: Props) {
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState<PnlIncomeMode>("exVat");
  const [proposed, setProposed] = useState(0);
  const [confirmedDays, setConfirmedDays] = useState(0);
  const [dayCount, setDayCount] = useState(0);
  const [totals, setTotals] = useState<MonthSalesTotals | null>(null);
  const [currentIncome, setCurrentIncome] = useState(0);
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
      setEditIncome(String(p.proposed || ""));
      setVatInputTotal(sumVatInput(inputs).vatInput);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unconfirmed = Math.max(0, dayCount - confirmedDays);
  const netVat = roundMoney((totals?.vatOutput || 0) - vatInputTotal);

  const applyIncome = async () => {
    const income = Number(String(editIncome).replace(/,/g, ""));
    if (!Number.isFinite(income) || income < 0) {
      setError("ยอดรายได้ไม่ถูกต้อง");
      return;
    }
    if (confirmedDays <= 0) {
      setError("ยังไม่มีวันที่ยืนยันในยอดขาย/VAT");
      return;
    }
    const warn =
      unconfirmed > 0 ? `\nยังมี ${unconfirmed} วันยังไม่ยืนยัน (ไม่นับ)` : "";
    if (
      !window.confirm(
        `ใส่รายได้ ${month} = ${formatPlainNumber(income)} เข้าสรุปรายเดือน?\n` +
          `จากวันยืนยัน ${confirmedDays} วัน · ${mode === "exVat" ? "ก่อน VAT" : "รวม VAT"}` +
          warn,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const audit = await closeVatMonthToIncome(month, actor, { forceIncome: income });
      setMsg(`ใส่รายได้ ${formatPlainNumber(audit.income)} แล้ว`);
      await refresh();
      onIncomeApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pnl-vat-panel" aria-label="ยอดขาย VAT ปิดเดือน">
      <div className="pnl-vat-head">
        <h2 className="pnl-section-title">ยอดขาย / VAT → รายได้</h2>
        <Link href="/vat-sales/?tab=daily" className="ghost-btn pnl-vat-link">
          ตารางวัน
        </Link>
      </div>
      <p className="muted pnl-vat-lead">
        จากวันที่ยืนยันในบช.เจ้าของ · ใส่เข้าช่องรายได้ด้านล่างได้ที่นี่
      </p>

      <div className="vat-sales-toolbar vat-sales-toolbar--slim">
        <label className="vat-sales-month">
          เดือน
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ghost-btn"
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          รี
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {loading ? (
        <p className="muted">กำลังโหลดยอด VAT...</p>
      ) : (
        <>
          <p className="vat-sales-hint">
            ยืนยัน <strong>{confirmedDays}</strong>/{dayCount}
            {unconfirmed > 0 ? (
              <span className="muted"> · ยังไม่ยืนยัน {unconfirmed}</span>
            ) : null}
            {" · "}
            โหมด <strong>{mode === "exVat" ? "ก่อน VAT" : "รวม VAT"}</strong>
            {" · "}
            ในงบตอนนี้ <strong>{fmt(currentIncome)}</strong>
          </p>

          {totals ? (
            <section className="vat-sales-summary vat-sales-summary--slim">
              <span>
                ส่ง <strong>{fmt(totals.deliveryGross)}</strong>
                <small className="muted">
                  {" "}
                  Sp {fmt(totals.shopee)} · G {fmt(totals.grab)} · LM{" "}
                  {fmt(totals.lineman)}
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
              <span className="muted">สุทธิ {fmt(netVat)}</span>
            </section>
          ) : null}

          {confirmedDays <= 0 ? (
            <p className="error-text">
              ยังไม่มีวันยืนยัน —{" "}
              <Link href="/vat-sales/?tab=daily">ไปตารางวัน</Link>
            </p>
          ) : (
            <div className="pnl-vat-apply">
              <label className="vat-sales-field">
                ยอดที่จะใส่
                <input
                  inputMode="decimal"
                  value={editIncome}
                  onChange={(e) => setEditIncome(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={() => void applyIncome()}
              >
                {busy ? "…" : "ใส่เป็นรายได้เดือนนี้"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => setEditIncome(String(proposed || ""))}
                title="ใช้ค่าเสนอจากวันยืนยัน"
              >
                ใช้เสนอ {fmt(proposed)}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
