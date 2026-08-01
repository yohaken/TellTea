"use client";

/**
 * D3/D4 — ข้อเสนอเดือน (L3)
 * D3 โครงเมล · D4 เติมยอดจาก parse · ยังไม่ผสานงบ (L4)
 */
import { useCallback, useEffect, useState } from "react";
import {
  listMonthProposals,
  mergeProposalIntoBooks,
  proposalSummaryLine,
  rebuildMonthProposalsFromCatalog,
  type VatDeliveryMonthProposal,
} from "@/lib/vat-delivery-month-proposals";
import { DELIVERY_CHANNELS } from "@/lib/vat-sales";
import { MONTH_CHANNEL_LABEL } from "@/lib/vat-month-sources";
import { formatThaiMonthKey } from "@/lib/vat-monthly";
import { formatVatMoney } from "@/lib/vat-number-format";

type Props = { actor: string };

function strategyLabel(s: string) {
  if (s === "daily-rollup") return "ม้วนรายวัน";
  if (s === "monthly-summary") return "สรุปเดือน";
  if (s === "mixed") return "ผสม";
  return "—";
}

function fmtAmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

export function VatMonthProposalsPanel({ actor }: Props) {
  const [rows, setRows] = useState<VatDeliveryMonthProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await listMonthProposals(18);
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rebuild = async (fillAmounts: boolean) => {
    setBusy(fillAmounts ? "fill" : "rebuild");
    setError("");
    setMsg("");
    try {
      const res = await rebuildMonthProposalsFromCatalog({
        maxReports: 300,
        actor,
        fillAmounts,
      });
      setRows(res.proposals);
      setMsg(
        fillAmounts
          ? `D4 เติมยอดในข้อเสนอแล้ว · ${res.months.length} เดือน · ยังไม่ทับงบ`
          : `D3 สร้างโครงแล้ว · ${res.months.length} เดือน จากเมล ${res.reportCount} · ยอดยังว่าง`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const mergeMonth = async (monthKey: string) => {
    const p = rows.find((x) => x.monthKey === monthKey);
    const salesHint = p
      ? DELIVERY_CHANNELS.map((ch) => {
          const a = p.channels[ch].amounts.appSales;
          return a != null && a > 0 ? `${ch}:${Math.round(a)}` : null;
        })
          .filter(Boolean)
          .join(" · ")
      : "";
    if (
      !window.confirm(
        `ผสานข้อเสนอ ${formatThaiMonthKey(monthKey)} เข้าตารางยอดเดลิเวอรี่?\n` +
          (salesHint || "ไม่มียอด") +
          "\n(ทับเฉพาะช่องที่มียอดในข้อเสนอ)",
      )
    ) {
      return;
    }
    setBusy(`merge:${monthKey}`);
    setError("");
    setMsg("");
    try {
      const res = await mergeProposalIntoBooks({ monthKey, actor });
      if (res.skipped) {
        setMsg(res.reason || "ข้ามการผสาน");
      } else {
        setMsg(
          `D5 ผสานงบแล้ว · ${monthKey} · ช่อง ${res.mergedChannels.join(", ")}`,
        );
        if (res.proposal) {
          setRows((prev) =>
            prev.map((x) =>
              x.monthKey === monthKey && res.proposal ? res.proposal : x,
            ),
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <section
      className="vat-table-block vat-month-proposals"
      aria-label="ข้อเสนอเดือน"
      data-ai-context="vat-delivery-month-proposals"
    >
      <h3 className="vat-table-subtitle">ข้อเสนอเดือน (D3→D5)</h3>
      <p className="muted vat-sales-hint">
        จัดกลุ่มเมล → เติมยอด → ผสานเข้างบเมื่อยืนยัน · ทับเฉพาะช่องที่มียอด
      </p>

      <div className="vat-mail-study-toolbar">
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busy) || loading}
          onClick={() => void rebuild(false)}
        >
          {busy === "rebuild" ? "สร้าง…" : "สร้างโครง (D3)"}
        </button>
        <button
          type="button"
          className="vat-mini-btn vat-mini-btn--primary"
          disabled={Boolean(busy) || loading}
          onClick={() => void rebuild(true)}
        >
          {busy === "fill" ? "เติมยอด…" : "เติมยอดจากเมล (D4)"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busy) || loading}
          onClick={() => void refresh()}
        >
          รีโหลด
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {loading ? (
        <p className="muted">กำลังโหลดข้อเสนอ…</p>
      ) : rows.length === 0 ? (
        <p className="muted vat-sales-hint">
          ยังไม่มีข้อเสนอ — กด「สร้างโครง」หรือ「เติมยอดจากเมล」
        </p>
      ) : (
        <div className="sheet-wrap vat-month-slim-wrap">
          <table className="sheet-table vat-sales-table vat-sales-table--slim">
            <thead>
              <tr>
                <th className="col-date">เดือน</th>
                <th className="col-seg">Grab</th>
                <th className="col-seg">LINE MAN</th>
                <th className="col-seg">Shopee</th>
                <th className="col-desc">เฟส</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const open = openMonth === p.monthKey;
                return (
                  <tr
                    key={p.monthKey}
                    className={open ? "is-open" : undefined}
                    onClick={() => setOpenMonth(open ? null : p.monthKey)}
                  >
                    <td className="col-date">
                      {formatThaiMonthKey(p.monthKey)}
                      <div className="muted vat-mail-study-snippet">
                        {proposalSummaryLine(p)}
                      </div>
                    </td>
                    {DELIVERY_CHANNELS.map((ch) => {
                      const c = p.channels[ch];
                      return (
                        <td key={ch} className="col-seg">
                          {c.reportIds.length ? (
                            <>
                              {fmtAmt(c.amounts.appSales)}
                              <div className="muted">
                                {c.reportIds.length}ฉบับ ·{" "}
                                {strategyLabel(c.strategy)}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                    <td
                      className="col-desc"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="muted">{p.phase}</span>
                      {p.status === "merged" ? (
                        <div className="muted">ผสานแล้ว</div>
                      ) : (
                        <button
                          type="button"
                          className="vat-mini-btn vat-mini-btn--primary"
                          disabled={
                            Boolean(busy) ||
                            !DELIVERY_CHANNELS.some((ch) => {
                              const a = p.channels[ch].amounts.appSales;
                              return (
                                p.channels[ch].amountsSource === "adapter" &&
                                a != null &&
                                a > 0
                              );
                            })
                          }
                          onClick={() => void mergeMonth(p.monthKey)}
                        >
                          {busy === `merge:${p.monthKey}`
                            ? "ผสาน…"
                            : "ผสานงบ (D5)"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openMonth ? (
        <div className="vat-mail-study-config">
          {rows
            .filter((p) => p.monthKey === openMonth)
            .map((p) => (
              <div key={p.monthKey}>
                <p className="muted vat-sales-hint">
                  {formatThaiMonthKey(p.monthKey)} · {p.phase} · {p.status}
                </p>
                {DELIVERY_CHANNELS.map((ch) => {
                  const c = p.channels[ch];
                  return (
                    <div key={ch} className="vat-mail-study-rule-row">
                      <strong>{MONTH_CHANNEL_LABEL[ch]}</strong>
                      <span className="muted">
                        ขาย {fmtAmt(c.amounts.appSales)} · โอน{" "}
                        {fmtAmt(c.amounts.transfer)} · GP{" "}
                        {fmtAmt(c.amounts.gpExVat)} · VAT-ซื้อ{" "}
                        {fmtAmt(c.amounts.gpVat)}
                        <br />
                        ใช้ {c.reportIds.length} · ข้าม {c.skipIds.length} ·{" "}
                        {strategyLabel(c.strategy)}
                        {c.note ? ` · ${c.note}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}
