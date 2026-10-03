"use client";

import { useMemo, useState } from "react";
import {
  isNoneOptionChoice,
  type PosDashOptionRow,
  type PosDashOptionsSummary,
} from "@/lib/pos-sales-dashboard";
import { formatPlainNumber, formatStockQty } from "@/lib/utils";

export const POS_DASH_OPTIONS_COLLAPSED = 20;

type SortBy = "qty" | "revenue";

function pctText(part: number, whole: number): string {
  if (!(whole > 0)) return "0.00%";
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function OptionSection({
  title,
  rows,
  paid,
}: {
  title: string;
  rows: PosDashOptionRow[];
  paid: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("qty");
  const sorted = useMemo(
    () =>
      paid && sortBy === "revenue"
        ? [...rows].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
        : rows,
    [rows, paid, sortBy],
  );
  const canExpand = sorted.length > POS_DASH_OPTIONS_COLLAPSED;
  const shown = expanded || !canExpand ? sorted : sorted.slice(0, POS_DASH_OPTIONS_COLLAPSED);
  const picks = rows.reduce((s, r) => s + r.qty, 0);
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <section className="pos-dash-opt-section" aria-label={title}>
      <div className="pos-dash-opt-head">
        <h4 className="pos-dash-subhead">
          {title}{" "}
          <span className="muted">
            {rows.length} รายการ · ×{formatStockQty(picks)}
            {paid ? ` · ${formatPlainNumber(revenue)} บาท` : ""}
          </span>
        </h4>
        <div className="pos-dash-opt-actions">
          {paid && rows.length > 1 ? (
            <div className="pos-ph-mode" role="tablist" aria-label="เรียงตาม">
              {(["qty", "revenue"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={sortBy === s}
                  className={sortBy === s ? "is-on" : ""}
                  onClick={() => setSortBy(s)}
                >
                  {s === "qty" ? "ครั้ง" : "บาท"}
                </button>
              ))}
            </div>
          ) : null}
          {canExpand ? (
            <button
              type="button"
              className="npos-slim-text-btn pos-dash-more"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "ย่อ" : `ดูเพิ่มเติม (${sorted.length})`}
            </button>
          ) : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted pos-dash-opt-empty">ไม่มีในช่วงนี้</p>
      ) : (
        <ol className="pos-dash-top-items pos-dash-opt-list">
          {shown.map((r, idx) => (
            <li key={r.key}>
              <span className="pos-dash-rank">{idx + 1}</span>
              <span className="pos-dash-opt-name" title={`${r.groupName} · ${r.name}`}>
                <span className="pos-dash-item-name">{r.name}</span>
                <span className="pos-dash-opt-meta">
                  {r.groupName}
                  {paid ? ` · +${formatPlainNumber(r.avgPrice)}` : ""} · {r.attachPct.toFixed(1)}%
                  ของชิ้น · {r.groupSharePct.toFixed(1)}% ในกลุ่ม
                </span>
              </span>
              <span className="pos-dash-item-qty" title="จำนวนครั้งที่เลือก">
                ×{formatStockQty(r.qty)}
              </span>
              <span
                className="pos-dash-item-amt"
                title={paid ? "รายได้จากตัวเลือก" : "สัดส่วนในกลุ่มตัวเลือกเดียวกัน"}
              >
                {paid ? formatPlainNumber(r.revenue) : `${r.groupSharePct.toFixed(1)}%`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {expanded && canExpand ? (
        <button
          type="button"
          className="npos-slim-text-btn pos-dash-more pos-dash-more--bottom"
          onClick={() => setExpanded(false)}
        >
          ย่อเหลือ {POS_DASH_OPTIONS_COLLAPSED} อันดับ
        </button>
      ) : null}
    </section>
  );
}

/**
 * ตัวเลือกยอดนิยม — แยกคิดเงิน / ไม่คิดเงิน · 20 อันดับ + กางดูทั้งหมด
 * - ×ครั้ง = จำนวนที่ถูกเลือก (เลือกซ้ำในชิ้นเดียวนับซ้ำ)
 * - % ของชิ้น = ชิ้นที่มีตัวเลือกนี้ ÷ ชิ้นที่ขายทั้งหมด
 * - % ในกลุ่ม = สัดส่วนในกลุ่มตัวเลือกเดียวกัน (รวมคิดเงิน + ไม่คิดเงิน)
 */
export function PosSalesDashboardOptions({ options }: { options: PosDashOptionsSummary }) {
  const [group, setGroup] = useState("");
  const [hideNone, setHideNone] = useState(false);
  const activeGroup = group && options.groups.includes(group) ? group : "";
  const noneCount = useMemo(
    () => options.free.filter((r) => isNoneOptionChoice(r.name)).length,
    [options.free],
  );
  const filter = useMemo(
    () => (list: PosDashOptionRow[]) =>
      list.filter(
        (r) =>
          (!activeGroup || r.groupName === activeGroup) && !(hideNone && isNoneOptionChoice(r.name)),
      ),
    [activeGroup, hideNone],
  );
  const paid = useMemo(() => filter(options.paid), [filter, options.paid]);
  const free = useMemo(() => filter(options.free), [filter, options.free]);
  const sectionKey = `${activeGroup}|${hideNone ? 1 : 0}`;

  return (
    <article className="pos-dash-card pos-dash-card--options" aria-label="ตัวเลือกยอดนิยม">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">ตัวเลือกยอดนิยม</h3>
        {options.groups.length > 1 ? (
          <select
            className="pos-dash-opt-group"
            value={activeGroup}
            onChange={(e) => setGroup(e.target.value)}
            aria-label="กรองกลุ่มตัวเลือก"
          >
            <option value="">ทุกกลุ่ม ({options.groups.length})</option>
            {options.groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="pos-dash-product-stats">
        <div>
          <span className="muted">ชิ้นที่มีตัวเลือก</span>
          <strong>
            {formatStockQty(options.cupsWithOption)}/{formatStockQty(options.totalCups)}
          </strong>
          <span className="muted">{pctText(options.cupsWithOption, options.totalCups)}</span>
        </div>
        <div>
          <span className="muted">รายได้ตัวเลือกคิดเงิน</span>
          <strong>{formatPlainNumber(options.paidRevenue)}</strong>
          <span className="muted">{formatStockQty(options.paidPicks)} ครั้ง</span>
        </div>
        <div>
          <span className="muted">ชิ้นที่จ่ายเพิ่ม</span>
          <strong>{formatStockQty(options.cupsWithPaidOption)}</strong>
          <span className="muted">{pctText(options.cupsWithPaidOption, options.totalCups)}</span>
        </div>
      </div>

      {options.totalCups === 0 ? (
        <p className="muted">ยังไม่มีรายการขายในช่วงนี้</p>
      ) : options.paid.length + options.free.length === 0 ? (
        <p className="muted">บิลในช่วงนี้ไม่มีการเลือกตัวเลือก</p>
      ) : (
        <>
          {noneCount > 0 ? (
            <label className="pos-dash-opt-toggle">
              <input
                type="checkbox"
                checked={hideNone}
                onChange={(e) => setHideNone(e.target.checked)}
              />
              ซ่อน «ไม่เพิ่ม…» ({noneCount})
            </label>
          ) : null}
          <OptionSection key={`p-${sectionKey}`} title="คิดเงิน" rows={paid} paid />
          <OptionSection key={`f-${sectionKey}`} title="ไม่คิดเงิน" rows={free} paid={false} />
        </>
      )}
    </article>
  );
}
