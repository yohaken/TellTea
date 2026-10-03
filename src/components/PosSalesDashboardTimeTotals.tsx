"use client";

import { useMemo, useState } from "react";
import type { PosDashTimeRow, PosDashTimeTotals } from "@/lib/pos-sales-dashboard";
import { formatPlainNumber, formatStockQty } from "@/lib/utils";

type HourSort = "time" | "total";

const bahtWhole = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

function Baht({ value }: { value: number }) {
  return <span title={formatPlainNumber(value)}>{bahtWhole.format(value)}</span>;
}

function Cells({ row, showPerDay }: { row: PosDashTimeRow; showPerDay: boolean }) {
  return (
    <>
      <td className="col-num">
        <Baht value={row.total} />
      </td>
      <td className="col-num col-pct">{row.pct.toFixed(1)}%</td>
      <td className="col-num">{formatStockQty(row.bills)}</td>
      <td className="col-num">
        <Baht value={row.avgBill} />
      </td>
      {showPerDay ? (
        <td className="col-num">
          <Baht value={row.perDay} />
        </td>
      ) : null}
    </>
  );
}

function Head({ first, showPerDay }: { first: string; showPerDay: boolean }) {
  return (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col" className="col-num">ยอด</th>
        <th scope="col" className="col-num col-pct">%</th>
        <th scope="col" className="col-num">บิล</th>
        <th scope="col" className="col-num">฿/บิล</th>
        {showPerDay ? (
          <th scope="col" className="col-num">฿/วัน</th>
        ) : null}
      </tr>
    </thead>
  );
}

/**
 * ยอดขายรวมตามช่วงเวลา — 3 กะ (ตรงกับกะ OT) + กางดูรายชั่วโมง
 * - ยอด = รับเงินจริงต่อบิล (หลังส่วนลด) ตามเวลาปิดบิล ปัดเป็นบาท (ทศนิยมใน title)
 * - ฿/วัน = ยอด ÷ จำนวนวันในช่วงที่เลือก (ซ่อนเมื่อเลือกวันเดียว)
 */
export function PosSalesDashboardTimeTotals({
  data,
  dayCount,
}: {
  data: PosDashTimeTotals;
  dayCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<HourSort>("time");
  const showPerDay = dayCount > 1;
  const activeHours = useMemo(() => {
    const list = data.hours.filter((h) => h.bills > 0);
    return sort === "total" ? [...list].sort((a, b) => b.total - a.total || a.hour - b.hour) : list;
  }, [data.hours, sort]);
  const maxBandPct = Math.max(...data.bands.map((b) => b.pct), 0);
  const maxHourTotal = Math.max(...data.hours.map((h) => h.total), 0);

  return (
    <article className="pos-dash-card pos-dash-card--time" aria-label="ยอดขายรวมตามช่วงเวลา">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">ยอดขายรวมตามช่วงเวลา</h3>
        {activeHours.length > 0 ? (
          <button
            type="button"
            className="npos-slim-text-btn pos-dash-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "ย่อ" : `ดูรายชั่วโมง (${activeHours.length})`}
          </button>
        ) : null}
      </div>

      {data.grand.bills === 0 ? (
        <p className="muted">ยังไม่มีรายการขายในช่วงนี้</p>
      ) : (
        <table className="pos-dash-time-table">
          <Head first="ช่วง" showPerDay={showPerDay} />
          <tbody>
            {data.bands.map((b) => (
              <tr key={b.id} className={b.pct === maxBandPct && b.pct > 0 ? "is-top" : ""}>
                <th scope="row">
                  <span className="pos-dash-time-band">
                    {b.label} <span className="muted">{b.range}</span>
                  </span>
                  <span className="pos-dash-time-meta">
                    <span className="pos-dash-time-pct">{b.pct.toFixed(1)}% · </span>
                    {b.peakHour !== null ? `พีค ${String(b.peakHour).padStart(2, "0")}:00 · ` : ""}
                    {formatStockQty(b.units)} ชิ้น
                  </span>
                  <span className="pos-dash-time-bar" aria-hidden>
                    <span style={{ width: `${Math.min(100, b.pct)}%` }} />
                  </span>
                </th>
                <Cells row={b} showPerDay={showPerDay} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">
                รวม <span className="pos-dash-time-meta">{formatStockQty(data.grand.units)} ชิ้น</span>
              </th>
              <Cells row={data.grand} showPerDay={showPerDay} />
            </tr>
          </tfoot>
        </table>
      )}

      {expanded && activeHours.length > 0 ? (
        <div className="pos-dash-time-hours">
          <div className="pos-dash-opt-head">
            <h4 className="pos-dash-subhead">
              รายชั่วโมง <span className="muted">{activeHours.length} ชั่วโมงที่มีบิล</span>
            </h4>
            <div className="pos-ph-mode" role="tablist" aria-label="เรียงตาม">
              {(["time", "total"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={sort === s}
                  className={sort === s ? "is-on" : ""}
                  onClick={() => setSort(s)}
                >
                  {s === "time" ? "เวลา" : "ยอด"}
                </button>
              ))}
            </div>
          </div>
          <table className="pos-dash-time-table pos-dash-time-table--hours">
            <Head first="ชั่วโมง" showPerDay={showPerDay} />
            <tbody>
              {activeHours.map((h) => (
                <tr key={h.hour}>
                  <th scope="row">
                    {h.label}
                    <span className="pos-dash-time-meta pos-dash-time-pct">{h.pct.toFixed(1)}%</span>
                    <span className="pos-dash-time-bar" aria-hidden>
                      <span
                        style={{
                          width: `${maxHourTotal > 0 ? Math.max(0, (h.total / maxHourTotal) * 100) : 0}%`,
                        }}
                      />
                    </span>
                  </th>
                  <Cells row={h} showPerDay={showPerDay} />
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="npos-slim-text-btn pos-dash-more pos-dash-more--bottom"
            onClick={() => setExpanded(false)}
          >
            ย่อรายชั่วโมง
          </button>
        </div>
      ) : null}
    </article>
  );
}
