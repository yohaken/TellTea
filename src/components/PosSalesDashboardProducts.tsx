"use client";

import { useMemo, useState } from "react";
import { ShoppingCart } from "lucide-react";
import {
  filterPosDashProducts,
  sumPosDashProducts,
  type PosDashProductSum,
  type PosDashProductsSummary,
} from "@/lib/pos-sales-dashboard";
import { formatPlainNumber, formatStockQty } from "@/lib/utils";

function truncate(name: string, max = 22): string {
  const t = (name || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export const POS_DASH_PRODUCTS_COLLAPSED = 20;

function SumLine({ label, sum }: { label: string; sum: PosDashProductSum }) {
  return (
    <div className="pos-dash-prod-sum-row">
      <span className="pos-dash-prod-sum-label">
        {label} {sum.count.toLocaleString("th-TH")} รายการ
      </span>
      <span className="pos-dash-item-qty" title="จำนวน">
        <ShoppingCart size={12} aria-hidden />
        {formatStockQty(sum.qty)}
      </span>
      <span className="pos-dash-prod-sum-amt">{formatPlainNumber(sum.total)}</span>
      <span className="pos-dash-prod-sum-pct">{sum.pct.toFixed(1)}%</span>
    </div>
  );
}

/**
 * ค้นหา → แสดงทุกรายการที่ตรง (ไม่ตัด 20) · ติ๊กเลือกได้ข้ามการค้นหา (เลือกค้างไว้แม้ถูกกรองออก)
 * ผลรวม «แสดง» = แถวที่เห็นตอนนี้ · «เลือก» = ที่ติ๊กทั้งหมด · % เทียบยอดสินค้าทั้งช่วง
 * อันดับคงตามอันดับยอดขายจริง ไม่เปลี่ยนตามผลค้นหา
 */
export function PosSalesDashboardProducts({ products }: { products: PosDashProductsSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const all = products.allItems;
  const searching = query.trim().length > 0;
  const canExpand = !searching && all.length > POS_DASH_PRODUCTS_COLLAPSED;

  const rank = useMemo(() => new Map(all.map((r, i) => [r.menuItemId, i + 1])), [all]);
  const matches = useMemo(() => filterPosDashProducts(all, query), [all, query]);
  const rows = searching || expanded || !canExpand ? matches : matches.slice(0, POS_DASH_PRODUCTS_COLLAPSED);
  const pickedRows = useMemo(() => all.filter((r) => picked.has(r.menuItemId)), [all, picked]);
  const shownSum = sumPosDashProducts(rows, products.lineTotal);
  const pickedSum = sumPosDashProducts(pickedRows, products.lineTotal);
  const allShownPicked = rows.length > 0 && rows.every((r) => picked.has(r.menuItemId));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickAllShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of rows) next.add(r.menuItemId);
      return next;
    });
  }

  function clearAll() {
    setPicked(new Set());
    setQuery("");
  }

  return (
    <article className="pos-dash-card pos-dash-card--products">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">สินค้า</h3>
        {canExpand ? (
          <button
            type="button"
            className="npos-slim-text-btn pos-dash-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "ย่อ" : `ดูเพิ่มเติม (${all.length})`}
          </button>
        ) : null}
      </div>

      <div className="pos-dash-product-stats">
        <div>
          <span className="muted">เมนูที่มีขาย</span>
          <strong>
            {products.soldMenuCount}/{products.activeMenuCount || products.soldMenuCount} เมนู
          </strong>
          <span className="muted">{products.soldMenuPct.toFixed(2)}%</span>
        </div>
        <div>
          <span className="muted">ขายดีสุด</span>
          <strong title={products.topItem?.name || ""}>
            {products.topItem ? truncate(products.topItem.name) : "—"}
          </strong>
          <span className="muted">{products.topItemPct.toFixed(2)}%</span>
        </div>
        <div>
          <span className="muted">หมวดขายดี</span>
          <strong title={products.topCategory?.name || ""}>
            {products.topCategory ? truncate(products.topCategory.name) : "—"}
          </strong>
          <span className="muted">{products.topCategoryPct.toFixed(2)}%</span>
        </div>
      </div>

      {all.length > 0 ? (
        <div className="pos-dash-prod-tools">
          <input
            type="search"
            className="pos-ph-search pos-dash-prod-search"
            placeholder="ค้นหาสินค้า / หมวด"
            aria-label="ค้นหาสินค้า"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="npos-slim-text-btn"
            disabled={allShownPicked}
            onClick={pickAllShown}
          >
            เลือกทั้งหมด
          </button>
          <button
            type="button"
            className="npos-slim-text-btn"
            disabled={!searching && picked.size === 0}
            onClick={clearAll}
          >
            ล้าง
          </button>
        </div>
      ) : null}

      <h4 className="pos-dash-subhead">
        {searching
          ? `ผลค้นหา ${matches.length} รายการ`
          : expanded && canExpand
            ? `สินค้าขายทั้งหมด ${all.length} รายการ`
            : `${Math.min(all.length, POS_DASH_PRODUCTS_COLLAPSED)} อันดับสินค้าขายดี`}
      </h4>
      {rows.length > 0 || pickedSum.count > 0 ? (
        <div className="pos-dash-prod-sum" aria-label="ผลรวม">
          {rows.length > 0 ? <SumLine label="แสดง" sum={shownSum} /> : null}
          {pickedSum.count > 0 ? <SumLine label="เลือก" sum={pickedSum} /> : null}
        </div>
      ) : null}

      {all.length === 0 ? (
        <p className="muted">ยังไม่มีรายการขายในช่วงนี้</p>
      ) : rows.length === 0 ? (
        <p className="muted">ไม่พบสินค้าที่ตรงกับ «{query.trim()}»</p>
      ) : (
        <ol className="pos-dash-top-items pos-dash-top-items--pick">
          {rows.map((row) => {
            const on = picked.has(row.menuItemId);
            return (
              <li key={row.menuItemId} className={on ? "is-picked" : undefined}>
                <input
                  type="checkbox"
                  className="pos-dash-prod-check"
                  checked={on}
                  onChange={() => toggle(row.menuItemId)}
                  aria-label={`เลือก ${row.name}`}
                />
                <span className="pos-dash-rank">{rank.get(row.menuItemId)}</span>
                <span className="pos-dash-item-name" title={row.name}>
                  {row.name}
                </span>
                <span className="pos-dash-item-qty" title="จำนวน">
                  <ShoppingCart size={12} aria-hidden />
                  {formatStockQty(row.qty)}
                </span>
                <span className="pos-dash-item-amt" title="ยอด">
                  {formatPlainNumber(row.total)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {expanded && canExpand ? (
        <button
          type="button"
          className="npos-slim-text-btn pos-dash-more pos-dash-more--bottom"
          onClick={() => setExpanded(false)}
        >
          ย่อเหลือ {POS_DASH_PRODUCTS_COLLAPSED} อันดับ
        </button>
      ) : null}
    </article>
  );
}
