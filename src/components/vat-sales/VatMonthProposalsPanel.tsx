"use client";

/**
 * D3 — ข้อเสนอเดือน (L3)
 * โชว์โครงวัตถุดิบต่อเดือน/ช่อง · ยอดยังว่าง · ยังไม่ผสานงบ
 */
import { useCallback, useEffect, useState } from "react";
import {
  listMonthProposals,
  proposalSummaryLine,
  rebuildMonthProposalsFromCatalog,
  type VatDeliveryMonthProposal,
} from "@/lib/vat-delivery-month-proposals";
import { DELIVERY_CHANNELS } from "@/lib/vat-sales";
import { MONTH_CHANNEL_LABEL } from "@/lib/vat-month-sources";
import { formatThaiMonthKey } from "@/lib/vat-monthly";

type Props = { actor: string };

function strategyLabel(s: string) {
  if (s === "daily-rollup") return "ม้วนรายวัน";
  if (s === "monthly-summary") return "สรุปเดือน";
  if (s === "mixed") return "ผสม";
  return "—";
}

export function VatMonthProposalsPanel({ actor }: Props) {
  const [rows, setRows] = useState<VatDeliveryMonthProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  const rebuild = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await rebuildMonthProposalsFromCatalog({
        maxReports: 300,
        actor,
      });
      setRows(res.proposals);
      setMsg(
        `สร้างข้อเสนอแล้ว · ${res.months.length} เดือน จากเมล ${res.reportCount} ฉบับ · ยอดยังว่าง (D3)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="vat-table-block vat-month-proposals"
      aria-label="ข้อเสนอเดือน"
      data-ai-context="vat-delivery-month-proposals"
    >
      <h3 className="vat-table-subtitle">ข้อเสนอเดือน (D3)</h3>
      <p className="muted vat-sales-hint">
        จัดกลุ่มเมลที่แท็กแล้วเป็นโครงต่อเดือน ·{" "}
        <strong>ยังไม่แกะยอด · ยังไม่ทับงบ</strong> — รอ D4 อะแดปเตอร์
      </p>

      <div className="vat-mail-study-toolbar">
        <button
          type="button"
          className="vat-mini-btn vat-mini-btn--primary"
          disabled={busy || loading}
          onClick={() => void rebuild()}
        >
          {busy ? "สร้าง…" : "สร้าง/รีเฟรชข้อเสนอ"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={busy || loading}
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
          ยังไม่มีข้อเสนอ — กด「สร้าง/รีเฟรชข้อเสนอ」หลังจูนแท็กเมลแล้ว
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
                <th className="col-desc">ยอด</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const open = openMonth === p.monthKey;
                return (
                  <tr
                    key={p.monthKey}
                    className={open ? "is-open" : undefined}
                    onClick={() =>
                      setOpenMonth(open ? null : p.monthKey)
                    }
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
                              {c.reportIds.length}
                              <div className="muted">
                                {strategyLabel(c.strategy)}
                                {c.dayCount ? ` · ${c.dayCount}ว` : ""}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                    <td className="col-desc muted">ว่าง (รอ D4)</td>
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
                  รายละเอียด {formatThaiMonthKey(p.monthKey)} · phase {p.phase}
                </p>
                {DELIVERY_CHANNELS.map((ch) => {
                  const c = p.channels[ch];
                  return (
                    <div key={ch} className="vat-mail-study-rule-row">
                      <strong>{MONTH_CHANNEL_LABEL[ch]}</strong>
                      <span className="muted">
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
