"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  formatVatMoney,
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
} from "@/lib/vat-number-format";
import {
  bangkokMonthKey,
  fileVatMonthlyReturn,
  loadVatMonthlyReturn,
  proposePnlIncome,
  roundMoney,
  type VatMonthlyReturn,
} from "@/lib/vat-monthly";

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

type Props = {
  actor: string;
  onIncomeApplied?: () => void;
};

/** แผง VAT รายเดือนบนหน้าสรุปรายเดือน — เฉพาะเจ้าของ */
export function PnlVatIncomePanel({ actor, onIncomeApplied }: Props) {
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [doc, setDoc] = useState<VatMonthlyReturn | null>(null);
  const [editIncome, setEditIncome] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const ret = await loadVatMonthlyReturn(month);
      setDoc(ret);
      setEditIncome(
        moneyFieldValue(
          ret.pnlIncome ||
            proposePnlIncome(ret.totals, ret.pnlIncomeMode) ||
            0,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totals = doc?.totals;
  const netVat = roundMoney(totals?.netVat || 0);

  const applyIncome = async () => {
    const income = parseVatMoneyInput(editIncome);
    if (!Number.isFinite(income) || income < 0) {
      setError("ยอดรายได้ไม่ถูกต้อง");
      return;
    }
    if (!totals || totals.grossSales <= 0) {
      setError("ยังไม่มียอดขายในเดือนนี้ — กรอกที่หน้า VAT ก่อน");
      return;
    }
    if (doc?.status === "filed") {
      setError("เดือนนี้ปิดแล้ว — ปลดล็อกที่หน้า VAT ก่อน");
      return;
    }
    const ok = window.confirm(
      `ใส่รายได้เดือน ${month} = ${formatVatMoney(income)} บาท เข้าสรุปรายเดือน (P&L)?`,
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const filed = await fileVatMonthlyReturn(month, actor, {
        forceIncome: income,
      });
      setDoc(filed);
      setMsg(`ใส่รายได้ ${formatVatMoney(filed.pnlIncome)} แล้ว`);
      onIncomeApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pnl-vat-apply">
      <header className="pnl-vat-apply-head">
        <h2>VAT รายเดือน → รายได้</h2>
        <Link href="/vat-sales/" className="ghost-btn">
          เปิดหน้า VAT
        </Link>
      </header>

      <label className="vat-sales-field">
        เดือน
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>

      {loading ? <p className="muted">กำลังโหลด…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      {doc && !loading ? (
        <>
          <p className="muted">
            ส่ง {fmt(doc.delivery.grossSales)} · ร้าน{" "}
            {fmt(doc.storefront.grossSales)} · รวม {fmt(doc.totals.grossSales)}
            {" · "}
            ภาษีขาย {fmt(doc.totals.outputVat)} − ซื้อ {fmt(doc.totals.inputVat)}{" "}
            = สุทธิ {fmt(netVat)}
            {doc.status === "filed" ? " · ปิดแล้ว" : ""}
          </p>
          <label className="vat-sales-field">
            ยอดรายได้ P&L
            <input
              inputMode="decimal"
              disabled={doc.status === "filed" || busy}
              value={editIncome}
              placeholder="0.00"
              onChange={(e) => setEditIncome(e.target.value)}
              onBlur={() => setEditIncome(normalizeMoneyFieldText(editIncome))}
            />
          </label>
          {doc.status !== "filed" ? (
            <button
              type="button"
              className="primary-btn"
              disabled={busy || doc.totals.grossSales <= 0}
              onClick={() => void applyIncome()}
            >
              ใส่รายได้เข้า P&L
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
