"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTimeShort, formatPlainNumber } from "@/lib/utils";
import { DELIVERY_CHANNEL_LABELS, type DeliveryChannel } from "@/lib/vat-sales";
import {
  buildReconcileRows,
  type ReconcileRow,
} from "@/lib/vat-sales-reconcile";
import { reparsePlatformEmailReport } from "@/lib/vat-sales-mail";

function fmt(n: number) {
  if (!n && n !== 0) return "—";
  return formatPlainNumber(n);
}

function channelLabel(ch: DeliveryChannel | "unknown") {
  if (ch === "unknown") return "ไม่ทราบช่องทาง";
  return DELIVERY_CHANNEL_LABELS[ch];
}

type Props = {
  month: string;
  onMonthChange: (m: string) => void;
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string) => void;
  setMsg: (v: string) => void;
};

export function VatSalesReconcilePanel({
  month,
  onMonthChange,
  busy,
  setBusy,
  setError,
  setMsg,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReconcileRow[]>([]);
  const [filterMonthOnly, setFilterMonthOnly] = useState(true);
  const [confirmedOnly, setConfirmedOnly] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await buildReconcileRows({
        ...(filterMonthOnly ? { monthKey: month } : {}),
        confirmedOnly,
      });
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, filterMonthOnly, confirmedOnly, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reparse = async (row: ReconcileRow) => {
    setBusy(`recon-${row.report.id}`);
    setError("");
    setMsg("");
    try {
      await reparsePlatformEmailReport(row.report);
      setMsg("Parse ใหม่แล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vat-recon-panel">
      <section className="vat-sales-settings vat-sales-settings--slim">
        <h2 className="vat-sales-section-title">เทียบ สัปดาห์/เดือน</h2>
        <p className="muted vat-sales-hint">
          สรุปแพลตฟอร์ม vs รวมวัน · <strong>ไม่ทับ</strong> ตารางวัน
        </p>
        <div className="vat-sales-toolbar vat-sales-toolbar--slim">
          <label className="vat-sales-month">
            เดือน
            <input
              type="month"
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
            />
          </label>
          <label className="check-row vat-sales-check-slim">
            <input
              type="checkbox"
              checked={filterMonthOnly}
              onChange={(e) => setFilterMonthOnly(e.target.checked)}
            />
            ทับเดือนนี้
          </label>
          <label className="check-row vat-sales-check-slim">
            <input
              type="checkbox"
              checked={confirmedOnly}
              onChange={(e) => setConfirmedOnly(e.target.checked)}
            />
            นับวันยืนยัน
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
      </section>

      {loading ? (
        <p className="muted">กำลังเทียบยอด...</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          ยังไม่มีเมลรายสัปดาห์/รายเดือนที่ parse ได้ — ซิงก์เมลแล้วกด Parse ในกล่องเมล
        </p>
      ) : (
        <div className="sheet-wrap vat-sales-scroll">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-recon-table">
            <thead>
              <tr>
                <th title="ชนิด">ชนิด</th>
                <th title="ช่องทาง">ช่อง</th>
                <th title="ช่วงรายงาน">ช่วง</th>
                <th className="col-num" title="ยอดแพลตฟอร์ม">แพลตฯ</th>
                <th className="col-num" title="ยอดในตารางวัน">ตาราง</th>
                <th className="col-num" title="ส่วนต่าง">ต่าง</th>
                <th title="จำนวนวันที่มียอด">วัน</th>
                <th className="col-desc">เมล</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const abs = Math.abs(r.diff);
                const warn = abs >= 1;
                const period =
                  r.periodStart && r.periodEnd
                    ? `${r.periodStart.slice(5)}→${r.periodEnd.slice(5)}`
                    : "—";
                return (
                  <tr key={r.report.id} className={warn ? "vat-recon-diff" : undefined}>
                    <td title={r.kind === "weekly" ? "รายสัปดาห์" : "รายเดือน"}>
                      {r.kind === "weekly" ? "ว" : "ด"}
                    </td>
                    <td title={channelLabel(r.channel)}>
                      {r.channel === "unknown"
                        ? "?"
                        : r.channel === "shopee"
                          ? "Sp"
                          : r.channel === "grab"
                            ? "G"
                            : "LM"}
                    </td>
                    <td title={`${r.periodStart} → ${r.periodEnd}`}>{period}</td>
                    <td className="col-num">{fmt(r.platformGross)}</td>
                    <td className="col-num">{fmt(r.booksGross)}</td>
                    <td className="col-num">
                      {fmt(r.diff)}
                      {r.diffPct != null ? (
                        <div className="muted vat-sales-src">{r.diffPct}%</div>
                      ) : null}
                    </td>
                    <td>{r.daysCounted}</td>
                    <td className="col-desc" title={r.report.subject || ""}>
                      <div className="vat-mail-subject">{r.report.subject || "(ไม่มีหัวข้อ)"}</div>
                      <div className="muted vat-sales-src">
                        {formatDateTimeShort(r.report.receivedAt)}
                      </div>
                    </td>
                    <td className="col-act">
                      <button
                        type="button"
                        className="ghost-btn vat-sales-act-btn"
                        disabled={busy !== null}
                        onClick={() => void reparse(r)}
                      >
                        Parse
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
