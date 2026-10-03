"use client";

import { useMemo, useState } from "react";
import type { PosDateRange } from "@/lib/pos-sales-report";
import {
  POS_DASH_TIME_BANDS,
  summarizePosSalesByWeekdayAvg,
  type PosDashTimeBandId,
} from "@/lib/pos-sales-dashboard";
import type { PosSale } from "@/lib/types";
import { formatPlainNumber, formatStockQty } from "@/lib/utils";

type Mode = "avg" | "total";
type Band = PosDashTimeBandId | "all";

const bahtWhole = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const baht = (n: number) => bahtWhole.format(n);

const BAND_OPTIONS: { id: Band; label: string }[] = [
  { id: "all", label: "ทั้งวัน" },
  ...POS_DASH_TIME_BANDS.map((b) => ({ id: b.id, label: b.label })),
];

/**
 * ยอดขายตามวันในสัปดาห์ — เฉลี่ยต่อวัน (หารจำนวนวันจริงของแต่ละวัน) หรือยอดรวม
 * - เฉลี่ย/วัน = ยอดรวมของวันนั้น ÷ จำนวนวันนั้นในช่วงที่เลือก · รวม = ยอดทั้งช่วง
 * - % = เทียบค่าเฉลี่ยของทุกวัน · แตะแถวดูวันที่และวิธีคิด
 * - วันที่ไม่มีขายก็นับเป็นวัน · วันนี้ (ยังไม่จบ) ไม่นับเมื่อช่วงมีวันก่อนหน้า
 * - กรองกะตามเวลาปิดบิล
 */
export function PosSalesDashboardWeekdays({
  sales,
  range,
}: {
  sales: PosSale[];
  range: PosDateRange;
}) {
  const [mode, setMode] = useState<Mode>("avg");
  const [band, setBand] = useState<Band>("all");
  const [openDay, setOpenDay] = useState<number | null>(null);
  const data = useMemo(
    () => summarizePosSalesByWeekdayAvg(sales, range, { band }),
    [sales, range, band],
  );

  const value = (r: (typeof data.rows)[number]) => (mode === "avg" ? r.avgPerDay : r.total);
  const max = Math.max(...data.rows.map(value), 0);
  const ranked = data.rows.filter((r) => r.days > 0 && r.total > 0);
  const best = ranked.length > 1 ? Math.max(...ranked.map(value)) : null;
  const worst = ranked.length > 1 ? Math.min(...ranked.map(value)) : null;

  return (
    <article className="pos-dash-card pos-dash-card--weekday" aria-label="ยอดขายตามวันในสัปดาห์">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">ยอดขายตามวันในสัปดาห์</h3>
        <div className="pos-ph-mode" role="tablist" aria-label="แสดงแบบ">
          {(["avg", "total"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "is-on" : ""}
              onClick={() => setMode(m)}
            >
              {m === "avg" ? "เฉลี่ย/วัน" : "รวม"}
            </button>
          ))}
        </div>
      </div>

      <div className="pos-ph-mode pos-dash-wd-bands" role="tablist" aria-label="ช่วงเวลา">
        {BAND_OPTIONS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={band === b.id}
            className={band === b.id ? "is-on" : ""}
            onClick={() => setBand(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <p className="pos-dash-wd-days">
        นับจาก {data.totalDays} วัน
        {data.excludedToday ? " (ไม่นับวันนี้ ยังไม่จบวัน)" : data.cappedAtToday ? " (ถึงวันนี้)" : ""} ·{" "}
        {data.rows
          .filter((r) => r.days > 0)
          .map((r) => `${r.short} ${r.days}`)
          .join(" · ")}
        {data.unequalDays && mode === "total" ? (
          <span className="pos-dash-wd-warn"> · จำนวนวันไม่เท่ากัน ดู «เฉลี่ย/วัน» จะเทียบได้ตรงกว่า</span>
        ) : null}
      </p>

      {data.totalDays === 0 ? (
        <p className="muted">ยังไม่มีวันที่จบวันในช่วงนี้</p>
      ) : (
        <ul className="pos-dash-wd-list">
          {data.rows.map((r) => {
            const v = value(r);
            const open = openDay === r.weekday;
            const tag = v === best ? "is-best" : v === worst ? "is-worst" : "";
            return (
              <li key={r.weekday} className={`pos-dash-wd-row ${tag}`}>
                <button
                  type="button"
                  className="pos-dash-wd-main"
                  aria-expanded={open}
                  disabled={r.days === 0}
                  onClick={() => setOpenDay(open ? null : r.weekday)}
                >
                  <span className="pos-dash-wd-label">
                    {r.label}
                    <span className="muted"> ×{r.days}</span>
                  </span>
                  <span className="pos-dash-wd-bar" aria-hidden>
                    <span style={{ width: `${max > 0 ? (v / max) * 100 : 0}%` }} />
                  </span>
                  <span className="pos-dash-wd-val">{baht(v)}</span>
                  <span className="pos-dash-wd-idx">
                    {r.days > 0 && r.index > 0 ? `${r.index - 100 >= 0 ? "+" : ""}${r.index - 100}%` : "—"}
                  </span>
                </button>
                {open ? (
                  <div className="pos-dash-wd-detail">
                    <p className="pos-dash-wd-calc">
                      รวม {formatPlainNumber(r.total)} ÷ {r.days} วัน ={" "}
                      <strong>{formatPlainNumber(r.avgPerDay)}</strong> บาท/วัน
                    </p>
                    <p className="muted">
                      บิล {formatStockQty(r.bills)} ({r.billsPerDay.toFixed(1)}/วัน) · ฿/บิล{" "}
                      {formatPlainNumber(r.avgBill)}
                      {r.daysWithSales < r.days ? ` · มีขาย ${r.daysWithSales}/${r.days} วัน` : ""}
                    </p>
                    <ul className="pos-dash-wd-dates">
                      {r.dates.map((d) => (
                        <li key={d.dateKey} className={d.bills === 0 ? "is-zero" : ""}>
                          <span>
                            {d.label}
                            {d.isToday ? " วันนี้" : ""}
                          </span>
                          <strong>{baht(d.total)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

    </article>
  );
}
