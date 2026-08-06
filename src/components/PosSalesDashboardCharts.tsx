"use client";

import { useMemo } from "react";
import type {
  PosDashDayPoint,
  PosDashHourPoint,
  PosDashWeekdayPoint,
} from "@/lib/pos-sales-dashboard";
import type { WeatherDayDoc } from "@/lib/pos-weather";
import { weatherCellTitle } from "@/lib/pos-weather";
import { formatPlainNumber } from "@/lib/utils";

function niceMax(raw: number): number {
  if (!(raw > 0)) return 1000;
  const pad = raw * 1.08;
  const mag = 10 ** Math.floor(Math.log10(pad));
  const norm = pad / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function yTicks(max: number, count = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round((max * i) / count));
  return out;
}

function formatAxisBaht(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`.replace(/\.0k$/, "k");
  return String(Math.round(n));
}

/** Numbers-first daily sales box — date + weather + amount (newest first). */
export function PosDashDailyTotalsTable({
  points,
  weatherByDay = {},
}: {
  points: PosDashDayPoint[];
  weatherByDay?: Record<string, WeatherDayDoc>;
}) {
  const rows = useMemo(() => [...points].reverse(), [points]);
  return (
    <section className="pos-dash-day-table-card" aria-label="ยอดขายรายวันตัวเลข">
      <h3 className="pos-dash-card-title">ยอดขายรายวัน</h3>
      <p className="muted pos-dash-day-weather-note">
        อากาศเมืองอุดรฯ · วันผ่านมาเซฟถาวร · วันนี้รีเฟรชไม่เกินทุก 45 นาที
      </p>
      {rows.length ? (
        <div className="pos-dash-day-table-scroll">
          <table className="pos-dash-day-table">
            <thead>
              <tr>
                <th scope="col">วันที่</th>
                <th scope="col">อากาศ</th>
                <th scope="col" className="is-num">
                  ยอดขาย
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const w = weatherByDay[p.dateKey];
                return (
                  <tr key={p.dateKey} className={p.total <= 0 ? "is-zero" : undefined}>
                    <td>{p.label}</td>
                    <td className="pos-dash-day-weather" title={weatherCellTitle(w)}>
                      {w ? (
                        <>
                          <span className="pos-dash-day-weather-main" aria-hidden={false}>
                            <span className="pos-dash-day-weather-emoji">{w.emoji}</span>
                            <span className="pos-dash-day-weather-label">{w.labelTh}</span>
                            {Number.isFinite(Number(w.tempMin)) &&
                            Number.isFinite(Number(w.tempMax)) ? (
                              <span className="pos-dash-day-weather-temp">
                                {Math.round(Number(w.tempMin))}–{Math.round(Number(w.tempMax))}°
                              </span>
                            ) : null}
                          </span>
                          {w.periods?.day?.emoji ||
                          w.periods?.evening?.emoji ||
                          w.periods?.night?.emoji ? (
                            <span className="pos-dash-day-weather-periods">
                              {w.periods.day?.emoji ? (
                                <span title={`กลางวัน ${w.periods.day.labelTh}`}>
                                  วัน{w.periods.day.emoji}
                                </span>
                              ) : null}
                              {w.periods.evening?.emoji ? (
                                <span title={`เย็น ${w.periods.evening.labelTh}`}>
                                  เย็น{w.periods.evening.emoji}
                                </span>
                              ) : null}
                              {w.periods.night?.emoji ? (
                                <span title={`ดึก ${w.periods.night.labelTh}`}>
                                  ดึก{w.periods.night.emoji}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted">…</span>
                      )}
                    </td>
                    <td className="is-num">
                      <strong>{formatPlainNumber(p.total)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted pos-dash-day-table-empty">ยังไม่มียอดในช่วงนี้</p>
      )}
    </section>
  );
}

export function PosDashDailyAreaChart({ points }: { points: PosDashDayPoint[] }) {
  const W = 720;
  const H = 220;
  const pad = { top: 16, right: 12, bottom: 48, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const { max, ticks, areaPath, linePath, dots, xLabels } = useMemo(() => {
    const maxVal = niceMax(Math.max(...points.map((p) => p.total), 0));
    const ticksY = yTicks(maxVal);
    const n = Math.max(points.length, 1);
    const xAt = (i: number) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => pad.top + innerH - (v / maxVal) * innerH;
    const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.total), p }));
    let line = "";
    coords.forEach((c, i) => {
      line += i === 0 ? `M ${c.x} ${c.y}` : ` L ${c.x} ${c.y}`;
    });
    const first = coords[0];
    const last = coords[coords.length - 1];
    const area =
      coords.length === 0
        ? ""
        : `${line} L ${last?.x ?? pad.left} ${pad.top + innerH} L ${first?.x ?? pad.left} ${pad.top + innerH} Z`;
    const labelStep = n > 20 ? 2 : 1;
    const labels = points
      .map((p, i) => ({ i, label: p.label, x: xAt(i) }))
      .filter((row) => row.i % labelStep === 0);
    return {
      max: maxVal,
      ticks: ticksY,
      areaPath: area,
      linePath: line,
      dots: coords,
      xLabels: labels,
    };
  }, [points, innerH, innerW, pad.left, pad.top]);

  return (
    <div className="pos-dash-chart-card">
      <h3 className="pos-dash-card-title">กราฟรายวัน</h3>
      <div className="pos-dash-chart-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="pos-dash-chart-svg" role="img" aria-label="กราฟยอดขายรายวัน">
          {ticks.map((t) => {
            const y = pad.top + innerH - (t / max) * innerH;
            return (
              <g key={t}>
                <line
                  x1={pad.left}
                  x2={W - pad.right}
                  y1={y}
                  y2={y}
                  className="pos-dash-chart-grid"
                />
                <text x={pad.left - 6} y={y + 3} textAnchor="end" className="pos-dash-chart-axis">
                  {formatAxisBaht(t)}
                </text>
              </g>
            );
          })}
          {areaPath ? <path d={areaPath} className="pos-dash-area-fill" /> : null}
          {linePath ? <path d={linePath} className="pos-dash-area-line" fill="none" /> : null}
          {dots.map((c) => (
            <circle key={c.p.dateKey} cx={c.x} cy={c.y} r={3.2} className="pos-dash-area-dot">
              <title>
                {c.p.label}: {formatPlainNumber(c.p.total)} บาท ({c.p.count} บิล)
              </title>
            </circle>
          ))}
          {xLabels.map((row) => (
            <text
              key={row.i}
              x={row.x}
              y={H - 10}
              textAnchor="end"
              transform={`rotate(-40 ${row.x} ${H - 10})`}
              className="pos-dash-chart-axis"
            >
              {row.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

function BarChart({
  title,
  points,
  colorClass,
}: {
  title: string;
  points: { label: string; total: number; count: number }[];
  colorClass: string;
}) {
  const W = 560;
  const H = 220;
  const pad = { top: 16, right: 10, bottom: 36, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...points.map((p) => p.total), 0));
  const ticks = yTicks(max);
  const gap = 0.28;
  const slot = innerW / Math.max(points.length, 1);
  const barW = slot * (1 - gap);

  return (
    <div className="pos-dash-chart-card">
      <h3 className="pos-dash-card-title">{title}</h3>
      <div className="pos-dash-chart-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="pos-dash-chart-svg" role="img" aria-label={title}>
          {ticks.map((t) => {
            const y = pad.top + innerH - (t / max) * innerH;
            return (
              <g key={t}>
                <line
                  x1={pad.left}
                  x2={W - pad.right}
                  y1={y}
                  y2={y}
                  className="pos-dash-chart-grid"
                />
                <text x={pad.left - 6} y={y + 3} textAnchor="end" className="pos-dash-chart-axis">
                  {formatAxisBaht(t)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => {
            const h = (p.total / max) * innerH;
            const x = pad.left + i * slot + (slot - barW) / 2;
            const y = pad.top + innerH - h;
            return (
              <g key={p.label}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(h, p.total > 0 ? 2 : 0)}
                  rx={2}
                  className={colorClass}
                >
                  <title>
                    {p.label}: {formatPlainNumber(p.total)} บาท ({p.count} บิล)
                  </title>
                </rect>
                <text
                  x={x + barW / 2}
                  y={H - 12}
                  textAnchor="middle"
                  className="pos-dash-chart-axis"
                >
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function PosDashHourBarChart({ points }: { points: PosDashHourPoint[] }) {
  return (
    <BarChart
      title="ยอดขายแยกตามช่วงเวลา"
      points={points}
      colorClass="pos-dash-bar--hour"
    />
  );
}

export function PosDashWeekdayBarChart({ points }: { points: PosDashWeekdayPoint[] }) {
  return (
    <BarChart
      title="ยอดขายแยกตามช่วงวัน"
      points={points}
      colorClass="pos-dash-bar--weekday"
    />
  );
}
