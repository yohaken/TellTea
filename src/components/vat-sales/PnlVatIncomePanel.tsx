"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatVatMoney } from "@/lib/vat-number-format";
import {
  bangkokMonthKey,
  loadVatMonthlyReturn,
  type VatMonthlyReturn,
} from "@/lib/vat-monthly";
import { vatReturnToPnlMonth, type PnlVatMonth } from "@/lib/pnl-vat-source";

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

const STATUS_LABEL: Record<VatMonthlyReturn["status"], string> = {
  draft: "ร่าง",
  saved: "บันทึกแล้ว",
  filed: "ปิดแล้ว",
};

/** แผงสรุป VAT เดือนบนหน้าสรุปรายเดือน — รายได้ไหลเข้าตาราง P&L เอง · เฉพาะเจ้าของ */
export function PnlVatIncomePanel() {
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ret, setRet] = useState<VatMonthlyReturn | null>(null);
  const [view, setView] = useState<PnlVatMonth | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    loadVatMonthlyReturn(month)
      .then((r) => {
        if (!alive) return;
        setRet(r);
        setView(vatReturnToPnlMonth(r));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [month]);

  return (
    <section className="pnl-vat-apply">
      <header className="pnl-vat-apply-head">
        <h2>VAT รายเดือน → รายได้ (อัตโนมัติ)</h2>
        <Link href="/vat-sales/" className="ghost-btn">
          เปิดหน้า VAT
        </Link>
      </header>

      <div className="pnl-vat-apply-row">
        <label className="vat-sales-field">
          เดือน
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        {ret && view && !loading ? (
          <p className="pnl-vat-apply-income" title="ยอดโอนถึงร้าน — ใช้เป็นรายได้ในตาราง P&L">
            รายได้ <strong>{fmt(view.income)}</strong>
          </p>
        ) : null}
      </div>

      {loading ? <p className="muted pnl-vat-apply-note">กำลังโหลด…</p> : null}
      {error ? <p className="error-text pnl-vat-apply-note">{error}</p> : null}
      {ret && view && !loading ? (
        <p className="muted pnl-vat-apply-note">
          ส่ง {fmt(ret.delivery.grossSales)} · ร้าน {fmt(ret.storefront.grossSales)}
          {" · "}
          ภาษีขาย {fmt(view.outputVat)} · VAT สุทธิ {fmt(view.netVat)}
          {" · "}
          {STATUS_LABEL[ret.status]}
        </p>
      ) : null}
    </section>
  );
}
