"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PnlMonthRow } from "@/lib/pnl";
import { formatPlainNumber } from "@/lib/utils";

export type PnlChartSeriesId =
  | "income"
  | "cogs"
  | "gross"
  | "sga"
  | "net"
  | "asset"
  | "cashPlus"
  | "purchaseVat"
  | "outputVat"
  | "netVat"
  | "profitAfterVat";

type SeriesDef = {
  id: PnlChartSeriesId;
  label: string;
  color: string;
  dashed?: boolean;
  ownerOnly?: boolean;
  get: (r: PnlMonthRow) => number;
  /** false = เดือนนั้นไม่มีข้อมูล → เว้นช่องในเส้น (ไม่ใช่ 0) */
  has?: (r: PnlMonthRow) => boolean;
};

const hasVatData = (r: PnlMonthRow) => r.outputVat !== 0 || r.netVat !== 0;

function seriesValue(s: SeriesDef, r: PnlMonthRow): number | null {
  if (s.has && !s.has(r)) return null;
  const v = s.get(r);
  return Number.isFinite(v) ? v : null;
}

export const PNL_CHART_SERIES: SeriesDef[] = [
  { id: "income", label: "รายได้", color: "#1c6b4a", get: (r) => r.income },
  { id: "cogs", label: "ต้นทุน", color: "#c45c26", get: (r) => r.cogs },
  { id: "gross", label: "กำไรขั้นต้น", color: "#2f6fed", get: (r) => r.gross },
  { id: "sga", label: "ค่าใช้จ่าย", color: "#e6a817", get: (r) => r.sga },
  { id: "net", label: "สุทธิ", color: "#6b4f9a", get: (r) => r.net },
  { id: "asset", label: "สินทรัพย์", color: "#7a8f3d", dashed: true, get: (r) => r.asset },
  { id: "cashPlus", label: "Cash+", color: "#1a9bb0", get: (r) => r.cashPlus },
  {
    id: "purchaseVat",
    label: "ภาษีซื้อ",
    color: "#8a6d3b",
    dashed: true,
    get: (r) => r.purchaseVat,
  },
  {
    id: "outputVat",
    label: "ภาษีขาย",
    color: "#b03d6e",
    dashed: true,
    ownerOnly: true,
    get: (r) => r.outputVat,
    has: hasVatData,
  },
  {
    id: "netVat",
    label: "VAT สุทธิ",
    color: "#d0457f",
    ownerOnly: true,
    get: (r) => r.netVat,
    has: hasVatData,
  },
  {
    id: "profitAfterVat",
    label: "หลัง VAT",
    color: "#3d3d8f",
    ownerOnly: true,
    get: (r) => r.profitAfterVat,
    has: hasVatData,
  },
];

const W = 960;
const H = 300;
const PAD = { top: 20, right: 24, bottom: 52, left: 60 };

const DEFAULT_ON: PnlChartSeriesId[] = ["income", "cogs", "sga", "net"];
const PREFS_KEY = "telltea.pnlTrendChart.v1";

function defaultVisible(): Record<PnlChartSeriesId, boolean> {
  const out = {} as Record<PnlChartSeriesId, boolean>;
  for (const s of PNL_CHART_SERIES) out[s.id] = DEFAULT_ON.includes(s.id);
  return out;
}

function loadVisible(): Record<PnlChartSeriesId, boolean> {
  const base = defaultVisible();
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Record<PnlChartSeriesId, unknown>>;
    for (const s of PNL_CHART_SERIES) {
      if (typeof saved[s.id] === "boolean") base[s.id] = saved[s.id] as boolean;
    }
  } catch {
    // ค่าเสีย → ใช้ค่าเริ่มต้น
  }
  return base;
}

type ChartPt = { x: number; y: number; value: number };

/** เส้นขาดตรงเดือนที่ไม่มีข้อมูล */
export function pnlChartLinePath(pts: Array<ChartPt | null>): string {
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${d ? " " : ""}${pen ? "L" : "M"} ${p.x} ${p.y}`;
    pen = true;
  }
  return d;
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** แกน Y มาตรฐาน — รวมค่าติดลบ · ขั้นเลขกลม */
export function pnlChartYAxis(
  values: number[],
  tickCount = 6,
): { lo: number; hi: number; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v));
  let min = Math.min(0, ...finite);
  let max = Math.max(0, ...finite);
  if (min === max) max = min + 1;
  const pad = (max - min) * 0.06;
  if (max > 0) max += pad;
  if (min < 0) min -= pad;
  const step = niceStep((max - min) / tickCount);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

function formatAxisBaht(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) {
    const k = Math.round(a / 100) / 10;
    return `${n < 0 ? "-" : ""}${String(k).replace(/\.0$/, "")}k`;
  }
  return String(Math.round(n));
}

/** 2025-06 → มิ.ย.68 */
const TH_MONTH_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

export function pnlMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const be = (Number(m[1]) + 543) % 100;
  return `${TH_MONTH_SHORT[Number(m[2]) - 1] ?? m[2]}${String(be).padStart(2, "0")}`;
}

/**
 * กราฟ X = เดือน · Y = บาท (แกนค่าจริงร่วมกัน) · เปิด/ปิดเส้นตามคอลัมน์ตาราง P&L
 * รูปแบบเดียวกับกราฟความสัมพันธ์ในแดชบอร์ดยอดขาย (legend toggle · crosshair · tooltip)
 */
export function PnlTrendChart({
  rows,
  isOwner,
}: {
  rows: PnlMonthRow[];
  isOwner: boolean;
}) {
  const pad = PAD;
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(defaultVisible);
  const [prefsReady, setPrefsReady] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tipLeftPx, setTipLeftPx] = useState(0);

  useEffect(() => {
    setVisible(loadVisible());
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(visible));
    } catch {
      // storage เต็ม/ปิด — ไม่จำค่า
    }
  }, [visible, prefsReady]);

  const allowed = useMemo(
    () => PNL_CHART_SERIES.filter((s) => isOwner || !s.ownerOnly),
    [isOwner],
  );
  const active = useMemo(
    () => allowed.filter((s) => visible[s.id]),
    [allowed, visible],
  );
  const single = active.length === 1 ? active[0] : null;

  const { lo, hi, ticks, xs, coords, labelStep } = useMemo(() => {
    const axis = pnlChartYAxis(
      active.flatMap((s) =>
        rows.map((r) => seriesValue(s, r)).filter((v): v is number => v != null),
      ),
    );
    const n = Math.max(rows.length, 1);
    const xAt = (i: number) =>
      pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const span = axis.hi - axis.lo || 1;
    const yAt = (v: number) => pad.top + innerH - ((v - axis.lo) / span) * innerH;
    const xsLocal = rows.map((_, i) => xAt(i));
    const c: Partial<Record<PnlChartSeriesId, Array<ChartPt | null>>> = {};
    for (const s of active) {
      c[s.id] = rows.map((r, i) => {
        const value = seriesValue(s, r);
        return value == null ? null : { x: xsLocal[i], y: yAt(value), value };
      });
    }
    return {
      ...axis,
      xs: xsLocal,
      coords: c,
      labelStep: n > 24 ? 3 : n > 12 ? 2 : 1,
    };
  }, [rows, active, innerH, innerW, pad.left, pad.top]);

  const yOf = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  function toggle(id: PnlChartSeriesId) {
    setVisible((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!allowed.some((s) => next[s.id])) return prev;
      return next;
    });
    setHoverIdx(null);
  }

  function indexFromClientX(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg || !rows.length) return null;
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    const xSvg = ((clientX - rect.left) / rect.width) * W;
    if (xSvg < pad.left - 8 || xSvg > W - pad.right + 8) return null;
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

  const hoverRow = hoverIdx != null ? rows[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xs[hoverIdx] : null;

  useLayoutEffect(() => {
    if (hoverIdx == null || hoverX == null || !hoverRow) return;
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const margin = 4;
    const wrapW = wrap.clientWidth;
    const tipW = tip.offsetWidth;
    const anchor = (hoverX / W) * wrapW;
    const maxLeft = Math.max(margin, wrapW - tipW - margin);
    setTipLeftPx(Math.min(maxLeft, Math.max(margin, anchor - tipW / 2)));
  }, [hoverIdx, hoverX, hoverRow, active]);

  useEffect(() => {
    if (hoverIdx != null && hoverIdx >= rows.length) setHoverIdx(null);
  }, [rows.length, hoverIdx]);

  return (
    <section className="pos-ops-corr-card pnl-trend-card" aria-label="กราฟรายได้ กำไร รายเดือน">
      <ul className="pos-ops-corr-legend" aria-label="เปิดปิดเส้นกราฟ">
        {allowed.map((s) => {
          const on = visible[s.id];
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`pos-ops-legend-btn${on ? "" : " is-off"}`}
                aria-pressed={on}
                onClick={() => toggle(s.id)}
              >
                <span
                  className="pos-ops-swatch"
                  style={{
                    background: s.color,
                    height: s.dashed ? undefined : "0.24rem",
                  }}
                />
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 ? (
        <p className="pnl-mini-hint">ยังไม่มีเดือนให้แสดงกราฟ</p>
      ) : (
        <div className="pos-ops-corr-svg-wrap" ref={wrapRef}>
          {hoverRow && active.length ? (
            <div
              ref={tipRef}
              className="pos-ops-corr-tooltip"
              style={{ left: tipLeftPx }}
              role="status"
            >
              <div className="pos-ops-corr-tooltip-date">{hoverRow.month}</div>
              <ul>
                {active.map((s) => (
                  <li key={s.id}>
                    <span className="pos-ops-swatch" style={{ background: s.color }} />
                    <span className="pos-ops-corr-tooltip-label">{s.label}</span>
                    <strong>
                      {(() => {
                        const v = seriesValue(s, hoverRow);
                        return v == null ? "—" : formatPlainNumber(v);
                      })()}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="pos-ops-corr-svg"
            role="img"
            aria-label={`กราฟรายเดือน ${active.map((s) => s.label).join(" ")}`}
            onPointerMove={(e) => setHoverIdx(indexFromClientX(e.clientX))}
            onPointerDown={(e) => setHoverIdx(indexFromClientX(e.clientX))}
            onPointerLeave={() => setHoverIdx(null)}
          >
            {ticks.map((t) => (
              <line
                key={`g-${t}`}
                x1={pad.left}
                x2={W - pad.right}
                y1={yOf(t)}
                y2={yOf(t)}
                className={t === 0 ? "pnl-trend-zero" : "pos-dash-chart-grid"}
              />
            ))}

            {active.map((s) => {
              const d = pnlChartLinePath(coords[s.id] ?? []);
              if (!d) return null;
              return (
                <path
                  key={s.id}
                  d={d}
                  className="pos-ops-line"
                  fill="none"
                  style={{
                    stroke: s.color,
                    strokeWidth: s.id === "income" ? 2.4 : 1.75,
                    strokeDasharray: s.dashed ? "4 3" : undefined,
                  }}
                />
              );
            })}

            {active.map((s) =>
              (coords[s.id] ?? []).map((pt, i) =>
                !pt ? null : (
                <circle
                  key={`${s.id}-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={single ? 2.75 : 2}
                  className="pos-ops-corr-dot"
                  style={{ stroke: s.color }}
                  pointerEvents="none"
                />
                ),
              ),
            )}

            {single
              ? (coords[single.id] ?? []).map((pt, i) =>
                  !pt || (i % labelStep !== 0 && i !== rows.length - 1) ? null : (
                    <text
                      key={`v-${i}`}
                      x={pt.x}
                      y={pt.value < 0 ? pt.y + 14 : pt.y - 8}
                      textAnchor="middle"
                      className="pos-ops-corr-value-label"
                      pointerEvents="none"
                    >
                      {formatAxisBaht(pt.value)}
                    </text>
                  ),
                )
              : null}

            {hoverX != null && hoverIdx != null ? (
              <g className="pos-ops-corr-crosshair" pointerEvents="none">
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={pad.top}
                  y2={pad.top + innerH}
                  className="pos-ops-corr-crosshair-line"
                />
                {active.map((s) => {
                  const pt = coords[s.id]?.[hoverIdx];
                  if (!pt) return null;
                  return (
                    <circle
                      key={s.id}
                      cx={hoverX}
                      cy={pt.y}
                      r={3.5}
                      className="pos-ops-corr-dot"
                      style={{ stroke: s.color }}
                    />
                  );
                })}
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

            {ticks.map((t) => (
              <text
                key={`y-${t}`}
                x={pad.left - 8}
                y={yOf(t) + 3}
                textAnchor="end"
                className="pos-dash-chart-axis pos-ops-corr-axis-y"
              >
                {formatAxisBaht(t)}
              </text>
            ))}

            {xs.map((x, i) =>
              i % labelStep !== 0 && i !== rows.length - 1 ? null : (
                <text
                  key={`x-${rows[i].month}`}
                  x={x}
                  y={pad.top + innerH + 14}
                  textAnchor="end"
                  transform={`rotate(-35 ${x} ${pad.top + innerH + 14})`}
                  className="pos-dash-chart-axis pos-ops-corr-axis-x"
                >
                  {pnlMonthLabel(rows[i].month)}
                </text>
              ),
            )}
          </svg>
        </div>
      )}
    </section>
  );
}
