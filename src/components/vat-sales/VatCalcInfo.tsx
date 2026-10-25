"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { formatVatMoney } from "@/lib/vat-number-format";
import type { CalcExplain } from "@/lib/vat-month-explain";

function money(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

/** ชื่อแถวที่แตะได้ → เปิด popup ที่มา */
export function VatCalcLabel({
  children,
  onOpen,
  className,
}: {
  children: ReactNode;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`vat-calc-label${className ? ` ${className}` : ""}`}
      onClick={onOpen}
    >
      <span className="vat-calc-label-text">{children}</span>
      <span className="vat-calc-label-i" aria-hidden>
        i
      </span>
    </button>
  );
}

/** popup ที่มาของตัวเลข — สูตร · ตัวเลขประกอบ · แหล่งข้อมูล · ข้อควรรู้ */
export function VatCalcInfoSheet({
  explain,
  onClose,
}: {
  explain: CalcExplain;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const neg = (explain.result ?? 0) < 0;

  return (
    <div className="modal-backdrop vat-calc-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card vat-calc-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`ที่มา ${explain.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vat-calc-head">
          <div>
            <p className="vat-calc-kicker">ที่มาของตัวเลข</p>
            <h3 className="vat-calc-title">{explain.title}</h3>
          </div>
          <button type="button" className="vat-calc-close" aria-label="ปิด" onClick={onClose}>
            ×
          </button>
        </div>

        {explain.result != null ? (
          <p className={`vat-calc-result${neg ? " is-neg" : ""}`}>
            {money(explain.result)}
            {explain.resultSuffix ? ` ${explain.resultSuffix}` : ""}
          </p>
        ) : null}

        <p className="vat-calc-formula">{explain.formula}</p>

        {explain.terms.length > 0 ? (
          <table className="vat-calc-terms">
            <tbody>
              {explain.terms.map((t, i) => (
                <tr key={`${t.label}-${i}`} className={t.subtotal ? "vat-calc-subtotal" : undefined}>
                  <td className="vat-calc-op">{t.subtotal ? "=" : (t.op ?? "")}</td>
                  <td className="vat-calc-term-label">
                    {t.label}
                    {t.hint ? <span className="vat-calc-hint"> · {t.hint}</span> : null}
                  </td>
                  <td className={`vat-calc-term-num${(t.amount ?? 0) < 0 ? " is-neg" : ""}`}>
                    {t.op === "×" ? "" : money(t.amount)}
                  </td>
                </tr>
              ))}
              {explain.result != null && explain.terms.length > 1 ? (
                <tr className="vat-calc-total">
                  <td className="vat-calc-op">=</td>
                  <td className="vat-calc-term-label">{explain.title}</td>
                  <td className={`vat-calc-term-num${neg ? " is-neg" : ""}`}>
                    {money(explain.result)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}

        {explain.sources.length > 0 ? (
          <section className="vat-calc-block">
            <h4>มาจากไหน</h4>
            <ul>
              {explain.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {explain.notes.length > 0 ? (
          <section className="vat-calc-block">
            <h4>ควรรู้</h4>
            <ul>
              {explain.notes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {explain.links.length > 0 ? (
          <div className="vat-calc-links">
            {explain.links.map((l) => (
              <Link key={l.href} href={l.href} className="vat-mini-btn">
                เปิด{l.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
