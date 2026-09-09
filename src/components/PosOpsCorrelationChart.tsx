"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  loadPosOpsCorrPrefs,
  savePosOpsCorrPrefs,
  OPS_SHIFT_SERIES,
  type PosOpsCorrSeriesId,
  type PosOpsDayPoint,
  defaultPosOpsCorrVisible,
} from "@/lib/pos-ops-correlation";
import { formatPlainNumber, formatStockQty } from "@/lib/utils";

type SeriesId = PosOpsCorrSeriesId;

type SeriesDef = {
  id: SeriesId;
  label: string;
  swatchClass: string;
  lineClass: string;
  get: (p: PosOpsDayPoint) => number;
  format: (n: number) => string;
  /** Compact value for on-line labels / absolute Y ticks (no unit suffix). */
  formatShort: (n: number) => string;
  unit: "baht" | "qty";
};

const SERIES: SeriesDef[] = [
  {
    id: "sales",
    label: "ยอดหน้าร้าน",
    swatchClass: "pos-ops-swatch--sales",
    lineClass: "pos-ops-line--sales",
    get: (p) => p.storefrontSales,
    format: (n) => `${formatPlainNumber(n)} บาท`,
    formatShort: (n) => formatPlainNumber(n),
    unit: "baht",
  },
  {
    id: "brewBonus",
    label: "โบนัสชงรวม",
    swatchClass: "pos-ops-swatch--brew-bonus",
    lineClass: "pos-ops-line--brew-bonus",
    get: (p) => p.brewBonus,
    format: (n) => `${formatPlainNumber(n)} บาท`,
    formatShort: (n) => formatPlainNumber(n),
    unit: "baht",
  },
  ...OPS_SHIFT_SERIES.map(
    (s): SeriesDef => ({
      id: s.id,
      label: s.label,
      swatchClass: `pos-ops-swatch--${s.id}`,
      lineClass: s.colorClass,
      get: (p) => p.byShift[s.id].bonus,
      format: (n) => `${formatPlainNumber(n)} บาท`,
      formatShort: (n) => formatPlainNumber(n),
      unit: "baht",
    }),
  ),
  {
    id: "brewQty",
    label: "หน่วยชง",
    swatchClass: "pos-ops-swatch--brew-qty",
    lineClass: "pos-ops-line--brew-qty",
    get: (p) => p.brewQty,
    format: (n) => `${formatStockQty(n)} หน่วย`,
    formatShort: (n) => formatStockQty(n),
    unit: "qty",
  },
  {
    id: "prodQty",
    label: "ชิ้นผลิต",
    swatchClass: "pos-ops-swatch--prod-qty",
    lineClass: "pos-ops-line--prod-qty",
    get: (p) => p.prodQty,
    format: (n) => `${formatStockQty(n)} ชิ้น`,
    formatShort: (n) => formatStockQty(n),
    unit: "qty",
  },
  {
    id: "prodBonus",
    label: "โบนัสผลิต",
    swatchClass: "pos-ops-swatch--prod-bonus",
    lineClass: "pos-ops-line--prod-bonus",
    get: (p) => p.prodBonus,
    format: (n) => `${formatPlainNumber(n)} บาท`,
    formatShort: (n) => formatPlainNumber(n),
    unit: "baht",
  },
];

const REL_MAX = 100;

function niceMax(raw: number): number {
  if (!(raw > 0)) return 1;
  const pad = raw * 1.08;
  const mag = 10 ** Math.floor(Math.log10(pad));
  const norm = pad / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function yTicks(max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const v = Math.round((max * i) / count);
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  if (out[out.length - 1] !== Math.round(max)) out.push(Math.round(max));
  return out;
}

function formatAxisPercent(n: number): string {
  return `${Math.round(n)}%`;
}

function linePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/**
 * Top correlation chart: storefront sales × brew units/bonus (by shift) × production.
 * Multiple series → each as % of its own peak. Single series → absolute Y + value labels on the line.
 * Legend toggles persist in localStorage. Tooltip shows absolute values.
 */
export function PosOpsCorrelationChart({ points }: { points: PosOpsDayPoint[] }) {
  const W = 960;
  const H = 320;
  // Extra gutters so full axis numerals (left) and tilted date labels (bottom) stay inside the SVG.
  const padBase = { top: 28, right: 28, bottom: 78, left: 48 };

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState<Record<SeriesId, boolean>>(defaultPosOpsCorrVisible);
  const [prefsReady, setPrefsReady] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  /** Pixel left edge of tooltip — clamped so the box stays inside the chart wrap. */
  const [tipLeftPx, setTipLeftPx] = useState(0);

  useEffect(() => {
    const prefs = loadPosOpsCorrPrefs();
    setVisible(prefs.visible);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    savePosOpsCorrPrefs({ visible, scaleMode: "relative" });
  }, [visible, prefsReady]);

  const activeSeries = useMemo(
    () => SERIES.filter((s) => visible[s.id]),
    [visible],
  );

  const singleSeries = activeSeries.length === 1 ? activeSeries[0] : null;
  const absoluteMode = Boolean(singleSeries);

  const pad = useMemo(() => {
    if (!absoluteMode || !singleSeries) return padBase;
    // Wider left gutter for absolute baht/qty numerals.
    return { ...padBase, left: singleSeries.unit === "baht" ? 64 : 56 };
  }, [absoluteMode, singleSeries]);

  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const { yMax, ticks, paths, xs, xLabels, pointCoords, labelStep } = useMemo(() => {
    const peakMap: Partial<Record<SeriesId, number>> = {};
    for (const s of activeSeries) {
      const peak = Math.max(0, ...points.map((p) => s.get(p)));
      peakMap[s.id] = peak > 0 ? peak : 1;
    }

    const absMax =
      absoluteMode && singleSeries
        ? niceMax(Math.max(0, ...points.map((p) => singleSeries.get(p))))
        : REL_MAX;

    const n = Math.max(points.length, 1);
    const xAt = (i: number) =>
      pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (value: number, series: SeriesDef) => {
      if (absoluteMode) {
        return pad.top + innerH - (value / absMax) * innerH;
      }
      const peak = peakMap[series.id] || 1;
      const pct = (value / peak) * REL_MAX;
      return pad.top + innerH - (pct / REL_MAX) * innerH;
    };

    const xsLocal = points.map((_, i) => xAt(i));
    const pathMap: Partial<Record<SeriesId, string>> = {};
    const coords: Partial<Record<SeriesId, Array<{ x: number; y: number; value: number }>>> =
      {};
    for (const s of activeSeries) {
      const pts = points.map((p, i) => {
        const value = s.get(p);
        return { x: xsLocal[i], y: yAt(value, s), value };
      });
      pathMap[s.id] = linePath(pts);
      coords[s.id] = pts;
    }

    const step = n > 120 ? 14 : n > 60 ? 7 : n > 31 ? 3 : n > 14 ? 2 : 1;
    const labels = points
      .map((p, i) => ({ i, label: p.label, x: xsLocal[i] }))
      .filter((row) => row.i % step === 0 || row.i === n - 1);

    const tickValues = absoluteMode ? yTicks(absMax) : yTicks(REL_MAX);

    return {
      yMax: absMax,
      ticks: tickValues,
      paths: pathMap,
      xs: xsLocal,
      xLabels: labels,
      pointCoords: coords,
      labelStep: step,
    };
  }, [points, activeSeries, absoluteMode, singleSeries, innerH, innerW, pad.left, pad.top]);

  const totals = useMemo(() => {
    return points.reduce(
      (acc, p) => ({
        sales: acc.sales + p.storefrontSales,
        brewQty: acc.brewQty + p.brewQty,
        brewBonus: acc.brewBonus + p.brewBonus,
        prodQty: acc.prodQty + p.prodQty,
        prodBonus: acc.prodBonus + p.prodBonus,
      }),
      { sales: 0, brewQty: 0, brewBonus: 0, prodQty: 0, prodBonus: 0 },
    );
  }, [points]);

  function toggleSeries(id: SeriesId) {
    setVisible((prev) => {
      const nextOn = !prev[id];
      const next = { ...prev, [id]: nextOn };
      // Keep at least one series on so the chart stays meaningful.
      if (!Object.values(next).some(Boolean)) return prev;
      return next;
    });
    setHoverIdx(null);
  }

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

  useLayoutEffect(() => {
    if (hoverIdx == null || hoverX == null || !hoverPoint) {
      return;
    }
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const margin = 4;
    const wrapW = wrap.clientWidth;
    const tipW = tip.offsetWidth;
    const anchor = (hoverX / W) * wrapW;
    const maxLeft = Math.max(margin, wrapW - tipW - margin);
    setTipLeftPx(Math.min(maxLeft, Math.max(margin, anchor - tipW / 2)));
  }, [hoverIdx, hoverX, hoverPoint, activeSeries]);

  const noteText = absoluteMode
    ? `แกน Y = ค่าจริงของ${singleSeries?.label ?? "ชุดนี้"} · ตัวเลขบนเส้น · แตะคำอธิบายเพื่อเปิด/ปิดเส้น · ตั้งค่าจำอัตโนมัติในเครื่องนี้`
    : "หลายเส้นเทียบสัดส่วนสูงสุดของตัวเองในช่วง (แกน %) · tooltip แสดงค่าจริง · แตะคำอธิบายเพื่อเปิด/ปิดเส้น · ตั้งค่าจำอัตโนมัติในเครื่องนี้ · ชี้หรือลากบนกราฟดูค่ารายวัน";

  const ariaLabel = absoluteMode
    ? `กราฟความสัมพันธ์ยอดขายชงผลิตรายวัน แกนค่าจริง ${singleSeries?.label ?? ""}`
    : "กราฟความสัมพันธ์ยอดขายชงผลิตรายวัน แกนสัมพัทธ์ร้อยละ";

  function formatTick(t: number): string {
    if (!absoluteMode || !singleSeries) return formatAxisPercent(t);
    return singleSeries.formatShort(t);
  }

  return (
    <section className="pos-ops-corr-card" aria-label="ความสัมพันธ์ยอดขาย ชง ผลิต">
      <div className="pos-ops-corr-head">
        <h3 className="pos-dash-card-title">ความสัมพันธ์ · หน้าร้าน × ชง × ผลิต</h3>
        <p className="muted pos-ops-corr-note">{noteText}</p>
      </div>
      <ul className="pos-ops-corr-legend" aria-label="เปิดปิดเส้นกราฟ">
        {SERIES.map((s) => {
          const on = visible[s.id];
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`pos-ops-legend-btn${on ? "" : " is-off"}`}
                aria-pressed={on}
                onClick={() => toggleSeries(s.id)}
              >
                <span className={`pos-ops-swatch ${s.swatchClass}`} />
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="pos-ops-corr-totals muted">
        รวมช่วงนี้ · ขาย {formatPlainNumber(totals.sales)} · หน่วยชง{" "}
        {formatStockQty(totals.brewQty)} · โบนัสชง {formatPlainNumber(totals.brewBonus)} · ผลิต{" "}
        {formatStockQty(totals.prodQty)} · โบนัสผลิต {formatPlainNumber(totals.prodBonus)}
      </div>
      <div className="pos-ops-corr-svg-wrap" ref={wrapRef}>
        {hoverPoint && activeSeries.length ? (
          <div
            ref={tipRef}
            className="pos-ops-corr-tooltip"
            style={{ left: tipLeftPx }}
            role="status"
          >
            <div className="pos-ops-corr-tooltip-date">{hoverPoint.label}</div>
            <ul>
              {activeSeries.map((s) => (
                <li key={s.id}>
                  <span className={`pos-ops-swatch ${s.swatchClass}`} />
                  <span className="pos-ops-corr-tooltip-label">{s.label}</span>
                  <strong>{s.format(s.get(hoverPoint))}</strong>
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
          aria-label={ariaLabel}
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

          {SERIES.map((s) => {
            const d = paths[s.id];
            if (!d) return null;
            return (
              <path
                key={s.id}
                d={d}
                className={`pos-ops-line ${s.lineClass}`}
                fill="none"
              />
            );
          })}

          {absoluteMode && singleSeries
            ? (pointCoords[singleSeries.id] ?? []).map((pt, i) => {
                if (i % labelStep !== 0 && i !== points.length - 1) return null;
                return (
                  <g key={`pt-${i}`} className="pos-ops-corr-point-label" pointerEvents="none">
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={2.75}
                      className={`pos-ops-corr-dot ${singleSeries.lineClass}`}
                    />
                    <text
                      x={pt.x}
                      y={pt.y - 8}
                      textAnchor="middle"
                      className="pos-ops-corr-value-label"
                    >
                      {singleSeries.formatShort(pt.value)}
                    </text>
                  </g>
                );
              })
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
              {activeSeries.map((s) => {
                const coords = pointCoords[s.id];
                const y = coords?.[hoverIdx]?.y ?? pad.top;
                return (
                  <circle
                    key={s.id}
                    cx={hoverX}
                    cy={y}
                    r={3.5}
                    className={`pos-ops-corr-dot ${s.lineClass}`}
                  />
                );
              })}
            </g>
          ) : null}

          {/* Hit area under axes so labels stay readable above the plot */}
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
                key={`pct-${i}-${t}`}
                x={pad.left - 8}
                y={y + 3}
                textAnchor="end"
                className="pos-dash-chart-axis pos-ops-corr-axis-y"
              >
                {formatTick(t)}
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
    </section>
  );
}
