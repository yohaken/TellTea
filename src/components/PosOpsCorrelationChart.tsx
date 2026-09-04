"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type SeriesScale = "baht" | "qty";

type SeriesDef = {
  id: SeriesId;
  label: string;
  swatchClass: string;
  lineClass: string;
  scale: SeriesScale;
  get: (p: PosOpsDayPoint) => number;
  format: (n: number) => string;
};

const SERIES: SeriesDef[] = [
  {
    id: "sales",
    label: "ยอดหน้าร้าน",
    swatchClass: "pos-ops-swatch--sales",
    lineClass: "pos-ops-line--sales",
    scale: "baht",
    get: (p) => p.storefrontSales,
    format: (n) => `${formatPlainNumber(n)} บาท`,
  },
  {
    id: "brewBonus",
    label: "โบนัสชงรวม",
    swatchClass: "pos-ops-swatch--brew-bonus",
    lineClass: "pos-ops-line--brew-bonus",
    scale: "baht",
    get: (p) => p.brewBonus,
    format: (n) => `${formatPlainNumber(n)} บาท`,
  },
  ...OPS_SHIFT_SERIES.map(
    (s): SeriesDef => ({
      id: s.id,
      label: s.label,
      swatchClass: `pos-ops-swatch--${s.id}`,
      lineClass: s.colorClass,
      scale: "baht",
      get: (p) => p.byShift[s.id].bonus,
      format: (n) => `${formatPlainNumber(n)} บาท`,
    }),
  ),
  {
    id: "brewQty",
    label: "หน่วยชง",
    swatchClass: "pos-ops-swatch--brew-qty",
    lineClass: "pos-ops-line--brew-qty",
    scale: "qty",
    get: (p) => p.brewQty,
    format: (n) => `${formatStockQty(n)} หน่วย`,
  },
  {
    id: "prodQty",
    label: "ชิ้นผลิต",
    swatchClass: "pos-ops-swatch--prod-qty",
    lineClass: "pos-ops-line--prod-qty",
    scale: "qty",
    get: (p) => p.prodQty,
    format: (n) => `${formatStockQty(n)} ชิ้น`,
  },
  {
    id: "prodBonus",
    label: "โบนัสผลิต",
    swatchClass: "pos-ops-swatch--prod-bonus",
    lineClass: "pos-ops-line--prod-bonus",
    scale: "baht",
    get: (p) => p.prodBonus,
    format: (n) => `${formatPlainNumber(n)} บาท`,
  },
];

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

function formatAxisNumber(n: number): string {
  return formatPlainNumber(Math.round(n));
}

function linePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/**
 * Top correlation chart: storefront sales × brew units/bonus (by shift) × production.
 * Legend toggles persist in localStorage; dual axes rescale to visible series.
 */
export function PosOpsCorrelationChart({ points }: { points: PosOpsDayPoint[] }) {
  const W = 960;
  const H = 320;
  // Extra gutters so full axis numerals (left/right) and tilted date labels (bottom) stay inside the SVG.
  const pad = { top: 20, right: 72, bottom: 78, left: 72 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [visible, setVisible] = useState<Record<SeriesId, boolean>>(defaultPosOpsCorrVisible);
  const [prefsReady, setPrefsReady] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const prefs = loadPosOpsCorrPrefs();
    setVisible(prefs.visible);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    savePosOpsCorrPrefs({ visible, scaleMode: "auto" });
  }, [visible, prefsReady]);

  const activeSeries = useMemo(
    () => SERIES.filter((s) => visible[s.id]),
    [visible],
  );

  const { bahtMax, qtyMax, bahtTicks, qtyTicks, paths, xs, showBaht, showQty, xLabels } =
    useMemo(() => {
      const bahtActive = activeSeries.filter((s) => s.scale === "baht");
      const qtyActive = activeSeries.filter((s) => s.scale === "qty");

      const bahtPeak = bahtActive.length
        ? Math.max(
            0,
            ...points.flatMap((p) => bahtActive.map((s) => s.get(p))),
          )
        : 0;
      const qtyPeak = qtyActive.length
        ? Math.max(0, ...points.flatMap((p) => qtyActive.map((s) => s.get(p))))
        : 0;

      const bMax = niceMax(bahtPeak || (bahtActive.length ? 1 : 1000));
      const qMax = niceMax(qtyPeak || (qtyActive.length ? 1 : 10));
      const n = Math.max(points.length, 1);
      const xAt = (i: number) =>
        pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const yBaht = (v: number) => pad.top + innerH - (v / bMax) * innerH;
      const yQty = (v: number) => pad.top + innerH - (v / qMax) * innerH;

      const xsLocal = points.map((_, i) => xAt(i));
      const pathMap: Partial<Record<SeriesId, string>> = {};
      for (const s of activeSeries) {
        const yOf = s.scale === "baht" ? yBaht : yQty;
        pathMap[s.id] = linePath(
          points.map((p, i) => ({ x: xsLocal[i], y: yOf(s.get(p)) })),
        );
      }

      const labelStep =
        n > 120 ? 14 : n > 60 ? 7 : n > 31 ? 3 : n > 14 ? 2 : 1;
      const labels = points
        .map((p, i) => ({ i, label: p.label, x: xsLocal[i] }))
        .filter((row) => row.i % labelStep === 0 || row.i === n - 1);

      return {
        bahtMax: bMax,
        qtyMax: qMax,
        bahtTicks: yTicks(bMax),
        qtyTicks: yTicks(qMax),
        paths: pathMap,
        xs: xsLocal,
        showBaht: bahtActive.length > 0,
        showQty: qtyActive.length > 0,
        xLabels: labels,
      };
    }, [points, activeSeries, innerH, innerW, pad.left, pad.top]);

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
  const tipLeftPct =
    hoverX != null ? Math.min(92, Math.max(8, (hoverX / W) * 100)) : 50;

  return (
    <section className="pos-ops-corr-card" aria-label="ความสัมพันธ์ยอดขาย ชง ผลิต">
      <div className="pos-ops-corr-head">
        <h3 className="pos-dash-card-title">ความสัมพันธ์ · หน้าร้าน × ชง × ผลิต</h3>
        <p className="muted pos-ops-corr-note">
          แตะคำอธิบายเพื่อเปิด/ปิดเส้น · สเกลปรับตามเส้นที่เปิด · ตั้งค่าจำอัตโนมัติในเครื่องนี้ ·
          ชี้หรือลากบนกราฟดูค่ารายวัน
        </p>
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
      <div className="pos-ops-corr-svg-wrap">
        {hoverPoint && activeSeries.length ? (
          <div
            className="pos-ops-corr-tooltip"
            style={{ left: `${tipLeftPct}%` }}
            role="status"
          >
            <div className="pos-ops-corr-tooltip-date">{hoverPoint.label}</div>
            <ul>
              {activeSeries.map((s) => (
                <li key={s.id}>
                  <span className={`pos-ops-swatch ${s.swatchClass}`} />
                  <span>{s.label}</span>
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
          aria-label="กราฟความสัมพันธ์ยอดขายชงผลิตรายวัน"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          {(showBaht ? bahtTicks : showQty ? qtyTicks : bahtTicks).map((t, i) => {
            const max = showBaht ? bahtMax : qtyMax;
            const y = pad.top + innerH - (t / max) * innerH;
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

          {hoverX != null ? (
            <g className="pos-ops-corr-crosshair" pointerEvents="none">
              <line
                x1={hoverX}
                x2={hoverX}
                y1={pad.top}
                y2={pad.top + innerH}
                className="pos-ops-corr-crosshair-line"
              />
              {activeSeries.map((s) => {
                const v = s.get(points[hoverIdx!]);
                const y =
                  pad.top +
                  innerH -
                  (v / (s.scale === "baht" ? bahtMax : qtyMax)) * innerH;
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

          {/* Axis labels painted last so lines/tooltip never cover them */}
          {showBaht
            ? bahtTicks.map((t, i) => {
                const y = pad.top + innerH - (t / bahtMax) * innerH;
                return (
                  <text
                    key={`b-${i}-${t}`}
                    x={pad.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    className="pos-dash-chart-axis pos-ops-corr-axis-y"
                  >
                    {formatAxisNumber(t)}
                  </text>
                );
              })
            : null}
          {showQty
            ? qtyTicks.map((t, i) => {
                const y = pad.top + innerH - (t / qtyMax) * innerH;
                return (
                  <text
                    key={`q-${i}-${t}`}
                    x={W - pad.right + 8}
                    y={y + 3}
                    textAnchor="start"
                    className="pos-dash-chart-axis pos-ops-corr-axis-y"
                  >
                    {formatAxisNumber(t)}
                  </text>
                );
              })
            : null}

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
