"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  PosDashDayPoint,
  PosDashHourPoint,
  PosDashWeekdayPoint,
} from "@/lib/pos-sales-dashboard";
import type { WeatherDayDoc } from "@/lib/pos-weather";
import { weatherCellTitle } from "@/lib/pos-weather";
import { formatPlainNumber } from "@/lib/utils";

function niceMax(raw: number): number {
  if (!(raw > 0)) return 1;
  const pad = raw * 1.08;
  const mag = 10 ** Math.floor(Math.log10(pad));
  const norm = pad / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function yTicks(max: number, count = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const v = Math.round((max * i) / count);
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  if (out[out.length - 1] !== Math.round(max)) out.push(Math.round(max));
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
  weatherLoading = false,
}: {
  points: PosDashDayPoint[];
  weatherByDay?: Record<string, WeatherDayDoc>;
  weatherLoading?: boolean;
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
                      {w && (w.labelTh || w.emoji) ? (
                        <>
                          <span className="pos-dash-day-weather-main">
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
                        <span className="muted">{weatherLoading ? "…" : "—"}</span>
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

/**
 * Daily sales line — same interaction as ops correlation single-series mode:
 * absolute Y, value labels on points, pointer crosshair + clamped tooltip.
 */
export function PosDashDailyAreaChart({ points }: { points: PosDashDayPoint[] }) {
  const W = 960;
  const H = 320;
  const pad = { top: 28, right: 28, bottom: 78, left: 64 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tipLeftPx, setTipLeftPx] = useState(0);

  const { yMax, ticks, areaPath, lineD, coords, xs, xLabels, labelStep } = useMemo(() => {
    const maxVal = niceMax(Math.max(0, ...points.map((p) => p.total)));
    const ticksY = yTicks(maxVal, 4);
    const n = Math.max(points.length, 1);
    const xAt = (i: number) =>
      pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => pad.top + innerH - (v / maxVal) * innerH;
    const pts = points.map((p, i) => ({
      x: xAt(i),
      y: yAt(p.total),
      value: p.total,
      p,
    }));
    const line = pts
      .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
      .join(" ");
    const first = pts[0];
    const last = pts[pts.length - 1];
    const area =
      pts.length === 0
        ? ""
        : `${line} L ${last?.x ?? pad.left} ${pad.top + innerH} L ${first?.x ?? pad.left} ${pad.top + innerH} Z`;
    const step = n > 120 ? 14 : n > 60 ? 7 : n > 31 ? 3 : n > 14 ? 2 : 1;
    const labels = points
      .map((p, i) => ({ i, label: p.label, x: xAt(i) }))
      .filter((row) => row.i % step === 0 || row.i === n - 1);
    return {
      yMax: maxVal,
      ticks: ticksY,
      areaPath: area,
      lineD: line,
      coords: pts,
      xs: pts.map((c) => c.x),
      xLabels: labels,
      labelStep: step,
    };
  }, [points, innerH, innerW, pad.left, pad.top]);

  function indexFromClientX(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg || !points.length) return null;
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    const xSvg = ((clientX - rect.left) / rect.width) * W;
    if (xSvg < pad.left || xSvg > W - pad.right) return null;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - xSvg);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    setHoverIdx(indexFromClientX(e.clientX));
  }

  function onPointerLeave() {
    setHoverIdx(null);
  }

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xs[hoverIdx] : null;
  const hoverY = hoverIdx != null ? coords[hoverIdx]?.y : null;

  useLayoutEffect(() => {
    if (hoverIdx == null || hoverX == null || !hoverPoint) return;
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const margin = 4;
    const wrapW = wrap.clientWidth;
    const tipW = tip.offsetWidth;
    const anchor = (hoverX / W) * wrapW;
    const maxLeft = Math.max(margin, wrapW - tipW - margin);
    setTipLeftPx(Math.min(maxLeft, Math.max(margin, anchor - tipW / 2)));
  }, [hoverIdx, hoverX, hoverPoint]);

  return (
    <div className="pos-dash-chart-card">
      <h3 className="pos-dash-card-title">กราฟรายวัน</h3>
      <p className="muted pos-ops-corr-note">
        แกน Y = ยอดขายจริง · ตัวเลขบนเส้น · ชี้หรือลากบนกราฟดูค่ารายวัน
      </p>
      <div className="pos-dash-chart-svg-wrap pos-ops-corr-svg-wrap" ref={wrapRef}>
        {hoverPoint ? (
          <div
            ref={tipRef}
            className="pos-ops-corr-tooltip"
            style={{ left: tipLeftPx }}
            role="status"
          >
            <div className="pos-ops-corr-tooltip-date">{hoverPoint.label}</div>
            <ul>
              <li>
                <span className="pos-ops-swatch pos-ops-swatch--sales" />
                <span className="pos-ops-corr-tooltip-label">ยอดขาย</span>
                <strong>{formatPlainNumber(hoverPoint.total)} บาท</strong>
              </li>
              <li>
                <span className="pos-ops-swatch pos-ops-swatch--sales" style={{ opacity: 0.35 }} />
                <span className="pos-ops-corr-tooltip-label">บิล</span>
                <strong>{hoverPoint.count.toLocaleString("th-TH")}</strong>
              </li>
            </ul>
          </div>
        ) : null}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="pos-dash-chart-svg pos-ops-corr-svg"
          role="img"
          aria-label="กราฟยอดขายรายวัน แกนค่าจริง"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          {ticks.map((t, i) => {
            const y = pad.top + innerH - (t / yMax) * innerH;
            return (
              <g key={`grid-${i}-${t}`}>
                <line
                  x1={pad.left}
                  x2={W - pad.right}
                  y1={y}
                  y2={y}
                  className="pos-dash-chart-grid"
                />
              </g>
            );
          })}
          {areaPath ? <path d={areaPath} className="pos-dash-area-fill" /> : null}
          {lineD ? (
            <path d={lineD} className="pos-dash-area-line pos-ops-line--sales" fill="none" />
          ) : null}

          {coords.map((pt, i) => {
            if (i % labelStep !== 0 && i !== points.length - 1) return null;
            return (
              <g key={pt.p.dateKey} className="pos-ops-corr-point-label" pointerEvents="none">
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={2.75}
                  className="pos-ops-corr-dot pos-ops-line--sales"
                />
                <text
                  x={pt.x}
                  y={pt.y - 8}
                  textAnchor="middle"
                  className="pos-ops-corr-value-label"
                >
                  {formatPlainNumber(pt.value)}
                </text>
              </g>
            );
          })}

          {hoverX != null && hoverY != null ? (
            <g className="pos-ops-corr-crosshair" pointerEvents="none">
              <line
                x1={hoverX}
                x2={hoverX}
                y1={pad.top}
                y2={pad.top + innerH}
                className="pos-ops-corr-crosshair-line"
              />
              <circle
                cx={hoverX}
                cy={hoverY}
                r={3.5}
                className="pos-ops-corr-dot pos-ops-line--sales"
              />
            </g>
          ) : null}

          <rect
            x={pad.left}
            y={pad.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            className="pos-ops-corr-hit"
          />

          {ticks.map((t, i) => {
            const y = pad.top + innerH - (t / yMax) * innerH;
            return (
              <text
                key={`y-${i}-${t}`}
                x={pad.left - 8}
                y={y + 3}
                textAnchor="end"
                className="pos-dash-chart-axis pos-ops-corr-axis-y"
              >
                {formatPlainNumber(t)}
              </text>
            );
          })}

          {xLabels.map((row) => (
            <text
              key={row.i}
              x={row.x}
              y={H - 14}
              textAnchor="end"
              transform={`rotate(-40 ${row.x} ${H - 14})`}
              className="pos-dash-chart-axis pos-ops-corr-axis-x"
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
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="pos-dash-chart-svg"
          role="img"
          aria-label={title}
        >
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
