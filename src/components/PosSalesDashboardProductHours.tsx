"use client";

import { useEffect, useMemo, useState } from "react";
import type { PosDashHourRow, PosDashProductHours } from "@/lib/pos-sales-dashboard";
import { formatStockQty } from "@/lib/utils";

type Mode = "product" | "category";

/** picked null = never chosen → follow current top N. */
type Prefs = { mode: Mode; picked: Record<Mode, string[] | null> };

export const POS_PRODUCT_HOURS_PREFS_KEY = "telltea.posDash.productHours.v1";
export const POS_PRODUCT_HOURS_DEFAULT_TOP = 8;

function loadPrefs(): Prefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POS_PRODUCT_HOURS_PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Prefs>;
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
    return {
      mode: p.mode === "category" ? "category" : "product",
      picked: { product: list(p.picked?.product), category: list(p.picked?.category) },
    };
  } catch {
    return null;
  }
}

function savePrefs(prefs: Prefs) {
  try {
    window.localStorage.setItem(POS_PRODUCT_HOURS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}

function hourRange(h: number): string {
  const a = String(h).padStart(2, "0");
  const b = String((h + 1) % 24).padStart(2, "0");
  return `${a}:00–${b}:00`;
}

/** Which products sell at which hour — heatmap, each row scaled to its own peak. */
export function PosSalesDashboardProductHours({ data }: { data: PosDashProductHours }) {
  const [mode, setMode] = useState<Mode>("product");
  const [picked, setPicked] = useState<Prefs["picked"]>({ product: null, category: null });
  const [prefsReady, setPrefsReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ key: string; hour: number } | null>(null);

  useEffect(() => {
    const p = loadPrefs();
    if (p) {
      setMode(p.mode);
      setPicked(p.picked);
    }
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    savePrefs({ mode, picked });
  }, [mode, picked, prefsReady]);

  const all = mode === "product" ? data.products : data.categories;
  const byKey = useMemo(() => new Map(all.map((r) => [r.key, r])), [all]);

  const pickedKeys = useMemo(
    () => picked[mode] ?? all.slice(0, POS_PRODUCT_HOURS_DEFAULT_TOP).map((r) => r.key),
    [picked, mode, all],
  );
  const pickedSet = useMemo(() => new Set(pickedKeys), [pickedKeys]);
  const rows = useMemo(
    () =>
      pickedKeys
        .map((k) => byKey.get(k))
        .filter((r): r is PosDashHourRow => Boolean(r))
        .sort((a, b) => b.qty - a.qty),
    [pickedKeys, byKey],
  );
  const missing = pickedKeys.length - rows.length;

  const hours = useMemo(() => {
    if (data.firstHour === null || data.lastHour === null) return [];
    const out: number[] = [];
    for (let h = data.firstHour; h <= data.lastHour; h += 1) out.push(h);
    return out;
  }, [data.firstHour, data.lastHour]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) => r.name.toLowerCase().includes(q) || r.categoryName.toLowerCase().includes(q),
    );
  }, [all, query]);

  const setKeys = (keys: string[]) => setPicked((prev) => ({ ...prev, [mode]: keys }));
  const toggle = (key: string) =>
    setKeys(pickedSet.has(key) ? pickedKeys.filter((k) => k !== key) : [...pickedKeys, key]);

  const focusRow = focus ? byKey.get(focus.key) : undefined;
  const unitLabel = "ชิ้น";

  return (
    <article className="pos-dash-card pos-ph-card" aria-label="สินค้าขายช่วงเวลาไหน">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">ขายช่วงไหน · สินค้า × ชั่วโมง</h3>
        <div className="pos-ph-mode" role="tablist">
          {(["product", "category"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "is-on" : ""}
              onClick={() => {
                setMode(m);
                setFocus(null);
                setQuery("");
              }}
            >
              {m === "product" ? "สินค้า" : "หมวด"}
            </button>
          ))}
        </div>
      </div>

      <div className="pos-ph-toolbar">
        <button
          type="button"
          className="npos-slim-text-btn pos-dash-more"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((v) => !v)}
        >
          {pickerOpen ? "ปิดรายการ" : `เลือก${mode === "product" ? "สินค้า" : "หมวด"} (${pickedKeys.length})`}
        </button>
        <button
          type="button"
          className="npos-slim-text-btn"
          onClick={() => setPicked((prev) => ({ ...prev, [mode]: null }))}
        >
          Top {POS_PRODUCT_HOURS_DEFAULT_TOP}
        </button>
        <button type="button" className="npos-slim-text-btn" onClick={() => setKeys([])}>
          ล้าง
        </button>
      </div>

      {pickerOpen ? (
        <div className="pos-ph-picker">
          <input
            type="search"
            className="pos-ph-search"
            placeholder={mode === "product" ? "ค้นหาสินค้า / หมวด" : "ค้นหาหมวด"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="pos-ph-pick-list">
            {filtered.map((r) => (
              <li key={r.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={pickedSet.has(r.key)}
                    onChange={() => toggle(r.key)}
                  />
                  <span className="pos-ph-pick-name">{r.name}</span>
                  <span className="pos-ph-pick-qty">{formatStockQty(r.qty)}</span>
                </label>
              </li>
            ))}
            {filtered.length === 0 ? <li className="muted">ไม่พบ</li> : null}
          </ul>
        </div>
      ) : null}

      {hours.length === 0 ? (
        <p className="muted">ยังไม่มีรายการขายในช่วงนี้</p>
      ) : pickedKeys.length === 0 ? (
        <p className="muted">ยังไม่ได้เลือก — กด «เลือก» แล้วติ๊กรายการที่อยากดู</p>
      ) : rows.length === 0 ? null : (
        <table className="pos-ph-table">
          <colgroup>
            <col className="pos-ph-col-name" />
            {hours.map((h) => (
              <col key={h} />
            ))}
            <col className="pos-ph-col-peak" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" />
              {hours.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
              <th scope="col">พีค</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rowMax = Math.max(...hours.map((h) => r.byHour[h]), 0);
              return (
                <tr key={r.key}>
                  <th scope="row" title={`${r.name} · ${formatStockQty(r.qty)} ${unitLabel}`}>
                    {r.name}
                  </th>
                  {hours.map((h) => {
                    const v = r.byHour[h];
                    const a = rowMax > 0 ? v / rowMax : 0;
                    const isFocus = focus?.key === r.key && focus.hour === h;
                    return (
                      <td
                        key={h}
                        className={`${v > 0 ? "has-v" : ""}${a >= 0.6 ? " is-hot" : ""}${isFocus ? " is-focus" : ""}`}
                        style={v > 0 ? { background: `rgba(47, 122, 79, ${0.12 + a * 0.83})` } : undefined}
                        title={`${r.name} · ${hourRange(h)} · ${formatStockQty(v)} ${unitLabel}`}
                        onClick={() => setFocus(isFocus ? null : { key: r.key, hour: h })}
                      >
                        {v > 0 ? formatStockQty(v) : ""}
                      </td>
                    );
                  })}
                  <td className="pos-ph-peak">{r.qty > 0 ? `${r.peakHour}น.` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {focusRow && focus ? (
        <p className="pos-ph-focus">
          <strong>{focusRow.name}</strong> · {hourRange(focus.hour)} ·{" "}
          {formatStockQty(focusRow.byHour[focus.hour])} {unitLabel} (
          {focusRow.qty > 0
            ? Math.round((focusRow.byHour[focus.hour] / focusRow.qty) * 100)
            : 0}
          % ของทั้งช่วง)
        </p>
      ) : null}
      {missing > 0 && hours.length > 0 ? (
        <p className="muted pos-ph-note">
          {rows.length > 0 ? `อีก ${missing}` : `ทั้ง ${missing}`} รายการที่เลือกไว้ไม่มียอดในช่วงวันที่นี้
        </p>
      ) : null}
    </article>
  );
}
