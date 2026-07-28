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
      <section className="vat-sales-settings">
        <h2 className="vat-sales-section-title">เทียบ สัปดาห์/เดือน</h2>
        <p className="muted vat-sales-hint">
          สรุปแพลตฟอร์ม vs รวมวัน · <strong>ไม่ทับ</strong> ตารางวัน
        </p>
        <div className="vat-sales-toolbar">
          <label className="vat-sales-month">
            เดือน
            <input
              type="month"
              value={month}
              onChange={(e) => onMonthChange(e.target.value)}
            />
          </label>
          <label className="vat-sales-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={filterMonthOnly}
              onChange={(e) => setFilterMonthOnly(e.target.checked)}
            />
            เฉพาะช่วงที่ทับเดือนนี้
          </label>
          <label className="vat-sales-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="checkbox"
              checked={confirmedOnly}
              onChange={(e) => setConfirmedOnly(e.target.checked)}
            />
            นับเฉพาะวันยืนยัน
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
          <table className="sheet-table vat-sales-table">
            <thead>
              <tr>
                <th>ชนิด</th>
                <th>ช่องทาง</th>
                <th>ช่วง</th>
                <th className="col-num">ยอดแพลตฟอร์ม</th>
                <th className="col-num">ยอดในตาราง</th>
                <th className="col-num">ส่วนต่าง</th>
                <th>วันที่มียอด</th>
                <th>เมล</th>
                <th className="col-act">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const abs = Math.abs(r.diff);
                const warn = abs >= 1;
                return (
                  <tr key={r.report.id} className={warn ? "vat-recon-diff" : undefined}>
                    <td>{r.kind === "weekly" ? "สัปดาห์" : "เดือน"}</td>
                    <td>{channelLabel(r.channel)}</td>
                    <td>
                      {r.periodStart} → {r.periodEnd}
                    </td>
                    <td className="col-num">{fmt(r.platformGross)}</td>
                    <td className="col-num">{fmt(r.booksGross)}</td>
                    <td className="col-num">
                      {fmt(r.diff)}
                      {r.diffPct != null ? (
                        <div className="muted vat-sales-src">{r.diffPct}%</div>
                      ) : null}
                    </td>
                    <td>{r.daysCounted}</td>
                    <td className="col-desc">
                      <div>{r.report.subject || "(ไม่มีหัวข้อ)"}</div>
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
                        Parse ใหม่
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
