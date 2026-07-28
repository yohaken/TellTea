"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTimeShort } from "@/lib/utils";
import {
  auditActionLabel,
  listVatSalesAudit,
  type VatSalesAuditEntry,
} from "@/lib/vat-sales-audit";

type Props = {
  month: string;
  onMonthChange: (m: string) => void;
  setError: (v: string) => void;
};

export function VatSalesAuditPanel({ month, onMonthChange, setError }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VatSalesAuditEntry[]>([]);
  const [filterMonth, setFilterMonth] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(
        await listVatSalesAudit({
          monthKey: filterMonth ? month : undefined,
          max: 100,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, filterMonth, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="vat-audit-panel">
      <section className="vat-sales-settings vat-sales-settings--slim">
        <h2 className="vat-sales-section-title">ประวัติ</h2>
        <p className="muted vat-sales-hint">แก้ยอด · ยืนยัน · เมล · ปิดเดือน · prune</p>
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
              checked={filterMonth}
              onChange={(e) => setFilterMonth(e.target.checked)}
            />
            เดือนนี้
          </label>
          <button type="button" className="ghost-btn" onClick={() => void refresh()}>
            รี
          </button>
        </div>
      </section>

      {loading ? (
        <p className="muted">กำลังโหลดประวัติ...</p>
      ) : rows.length === 0 ? (
        <p className="muted">ยังไม่มีประวัติ</p>
      ) : (
        <div className="sheet-wrap vat-sales-scroll">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-audit-table">
            <thead>
              <tr>
                <th className="col-date">เมื่อ</th>
                <th>การกระทำ</th>
                <th className="col-desc">สรุป</th>
                <th>โดย</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} title={r.summary}>
                  <td className="col-date">{formatDateTimeShort(r.at)}</td>
                  <td>{auditActionLabel(r.action)}</td>
                  <td className="col-desc">
                    <div className="vat-mail-subject">{r.summary}</div>
                  </td>
                  <td className="vat-audit-actor" title={r.actor}>
                    {r.actor.includes("@") ? r.actor.split("@")[0] : r.actor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
