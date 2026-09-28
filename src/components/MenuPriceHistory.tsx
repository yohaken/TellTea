"use client";

import { useMemo, useState } from "react";
import {
  listItemPriceHistory,
  listOptionPriceHistory,
  priceChangeLabel,
  priceSourceLabel,
  priceStepsFromRows,
  type MenuPriceHistoryRow,
  type PriceStep,
} from "@/lib/menu-price-history";
import { formatDateShort, formatDateTimeShort, formatPlainNumber } from "@/lib/utils";

const CHART_W = 340;
const CHART_H = 170;
const PAD = { top: 20, right: 14, bottom: 24, left: 30 };

function editorLabel(row: MenuPriceHistoryRow): string {
  if (!row.by) return "—";
  if (row.source === "npos") return `เครื่อง ${row.by.slice(0, 6)}`;
  const at = row.by.indexOf("@");
  return at > 0 ? row.by.slice(0, at) : row.by;
}

const wholeBahtFmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

function baht(v: number): string {
  return Number.isInteger(v) ? wholeBahtFmt.format(v) : formatPlainNumber(v);
}

function deltaText(row: MenuPriceHistoryRow): string {
  const label = priceChangeLabel(row.change);
  if (label) return label;
  if (row.from == null || row.to == null) return "—";
  const d = Math.round((row.to - row.from) * 100) / 100;
  return `${d > 0 ? "+" : ""}${baht(d)}`;
}

function money(v: number | null): string {
  return v == null ? "—" : `฿${baht(v)}`;
}

/** Dev only: `?priceDemo=13-14` (or `13-14-15`) fakes one change per hour ending now. */
function demoRowsFromUrl(itemId: string): MenuPriceHistoryRow[] | undefined {
  const raw = new URLSearchParams(window.location.search).get("priceDemo");
  const prices = (raw || "").split("-").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (prices.length < 2) return undefined;
  const now = Date.now();
  return prices.map((to, i) => ({
    id: `demo${i}`,
    kind: "item",
    itemId,
    name: "",
    change: i === 0 ? "created" : "price",
    from: i === 0 ? null : prices[i - 1],
    to,
    at: now - (prices.length - 1 - i) * 3 * 60 * 60 * 1000,
    source: i === 0 ? "script" : "boh",
    by: i === 0 ? "baseline" : "demo@local",
  }));
}

const timeFmt = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

function PriceStepChart({ steps }: { steps: PriceStep[] }) {
  const now = Date.now();
  const t0 = steps[0].at;
  const lastAt = Math.max(now, steps[steps.length - 1].at);
  const t1 = lastAt + Math.max((lastAt - t0) * 0.1, 30 * 60 * 1000);
  const prices = steps.map((s) => s.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || Math.max(1, hi * 0.2);
  const yMin = Math.max(0, lo - span * 0.6);
  const yMax = hi + span * 0.6;
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * innerW;
  const y = (p: number) => PAD.top + (1 - (p - yMin) / (yMax - yMin || 1)) * innerH;

  let d = `M${x(steps[0].at)},${y(steps[0].price)}`;
  for (let i = 1; i < steps.length; i += 1) {
    d += ` H${x(steps[i].at)} V${y(steps[i].price)}`;
  }
  d += ` H${x(t1)}`;

  const levels = [...new Set(prices)].sort((a, b) => a - b);
  const yTicks = levels.length <= 4 ? levels : [lo, hi];
  const sameDay = t1 - t0 < 36 * 60 * 60 * 1000;
  let lastLabelX = -Infinity;
  const xLabels = steps.map((s) => {
    const cx = Math.min(Math.max(x(s.at), PAD.left + 18), CHART_W - PAD.right - 18);
    const show = cx - lastLabelX >= 40;
    if (show) lastLabelX = cx;
    return { cx, show, text: sameDay ? timeFmt.format(s.at) : formatDateShort(s.at) };
  });

  return (
    <svg
      className="menu-price-history-chart"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label="กราฟราคาหน้าร้านตามวันที่"
    >
      {yTicks.map((v) => (
        <g key={`y-${v}`}>
          <line
            x1={PAD.left}
            x2={CHART_W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            className="menu-price-history-grid"
          />
          <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="menu-price-history-axis">
            {baht(v)}
          </text>
        </g>
      ))}
      <path d={d} className="menu-price-history-line" />
      {steps.map((s, i) => (
        <g key={`${i}-${s.at}`}>
          <circle cx={x(s.at)} cy={y(s.price)} r={3.5} className="menu-price-history-dot" />
          <text x={x(s.at)} y={y(s.price) - 8} textAnchor="middle" className="menu-price-history-value">
            ฿{baht(s.price)}
          </text>
          {xLabels[i].show ? (
            <text x={xLabels[i].cx} y={CHART_H - 8} textAnchor="middle" className="menu-price-history-axis">
              {xLabels[i].text}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

export function MenuPriceHistory({
  itemId,
  linkedGroupIds,
}: {
  itemId: string;
  linkedGroupIds: string[];
}) {
  const [itemRows, setItemRows] = useState<MenuPriceHistoryRow[] | null>(null);
  const [optionRows, setOptionRows] = useState<MenuPriceHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (process.env.NODE_ENV === "development") {
        const demoMap = (window as unknown as { __menuPriceHistoryDemo?: Record<string, MenuPriceHistoryRow[]> })
          .__menuPriceHistoryDemo;
        const demo = demoMap?.[itemId] ?? demoMap?.["*"] ?? demoRowsFromUrl(itemId);
        if (demo) {
          setItemRows([...demo].sort((a, b) => a.at - b.at));
          setOptionRows([]);
          return;
        }
      }
      const [items, options] = await Promise.all([
        listItemPriceHistory(itemId),
        listOptionPriceHistory(linkedGroupIds),
      ]);
      setItemRows(items);
      setOptionRows(options.filter((r) => r.change !== "created"));
    } catch (err) {
      setError((err as Error).message || "โหลดประวัติราคาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  const steps = useMemo(() => priceStepsFromRows(itemRows || []), [itemRows]);
  const newestFirst = useMemo(() => [...(itemRows || [])].reverse(), [itemRows]);
  const optionNewestFirst = useMemo(() => [...optionRows].reverse().slice(0, 40), [optionRows]);

  return (
    <details
      className="pos-menu-editor-card menu-price-history"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && itemRows == null && !loading) void load();
      }}
    >
      <summary className="pos-menu-editor-card-title menu-price-history-summary">ประวัติราคาหน้าร้าน</summary>

      {loading ? <p className="muted">กำลังโหลด…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {itemRows && !itemRows.length && !loading ? (
        <p className="muted">ยังไม่มีการเปลี่ยนราคาตั้งแต่เปิดระบบบันทึกประวัติ</p>
      ) : null}

      {steps.length ? <PriceStepChart steps={steps} /> : null}

      {newestFirst.length ? (
        <div className="menu-price-history-table-wrap">
          <table className="menu-price-history-table">
            <thead>
              <tr>
                <th>วันที่ · เวลา</th>
                <th className="num">เดิม</th>
                <th className="num">ใหม่</th>
                <th className="num">เปลี่ยน</th>
                <th>แก้จาก</th>
                <th>โดย</th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.from != null && r.to != null
                      ? r.to > r.from
                        ? "is-up"
                        : r.to < r.from
                          ? "is-down"
                          : ""
                      : ""
                  }
                >
                  <td>{formatDateTimeShort(r.at)}</td>
                  <td className="num">{money(r.from)}</td>
                  <td className="num">{money(r.to)}</td>
                  <td className="num">{deltaText(r)}</td>
                  <td>{priceSourceLabel(r.source)}</td>
                  <td>{editorLabel(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {optionNewestFirst.length ? (
        <>
          <h3 className="menu-price-history-subtitle">ราคาตัวเลือกที่ผูกกับเมนูนี้</h3>
          <div className="menu-price-history-table-wrap">
            <table className="menu-price-history-table">
              <thead>
                <tr>
                  <th>วันที่ · เวลา</th>
                  <th>ตัวเลือก</th>
                  <th className="num">เดิม</th>
                  <th className="num">ใหม่</th>
                  <th>แก้จาก</th>
                </tr>
              </thead>
              <tbody>
                {optionNewestFirst.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTimeShort(r.at)}</td>
                    <td>
                      {r.name} › {r.choiceName || "—"}
                      {priceChangeLabel(r.change) ? (
                        <span className="muted"> · {priceChangeLabel(r.change)}</span>
                      ) : null}
                    </td>
                    <td className="num">{money(r.from)}</td>
                    <td className="num">{money(r.to)}</td>
                    <td>{priceSourceLabel(r.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {itemRows ? (
        <button type="button" className="ghost-btn pos-menu-btn-sm menu-price-history-reload" onClick={() => void load()}>
          โหลดใหม่
        </button>
      ) : null}
    </details>
  );
}
