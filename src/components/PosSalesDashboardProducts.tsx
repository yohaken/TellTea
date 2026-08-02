"use client";

import { ShoppingCart } from "lucide-react";
import type { PosDashProductsSummary } from "@/lib/pos-sales-dashboard";
import { formatPlainNumber, formatStockQty } from "@/lib/utils";

function truncate(name: string, max = 22): string {
  const t = (name || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function PosSalesDashboardProducts({
  products,
  onOpenMenu,
}: {
  products: PosDashProductsSummary;
  onOpenMenu?: () => void;
}) {
  return (
    <article className="pos-dash-card pos-dash-card--products">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">สินค้า</h3>
        {onOpenMenu ? (
          <button type="button" className="npos-slim-text-btn pos-dash-more" onClick={onOpenMenu}>
            ดูเพิ่มเติม
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

      <h4 className="pos-dash-subhead">10 อันดับสินค้าขายดี</h4>
      {products.topItems.length === 0 ? (
        <p className="muted">ยังไม่มีรายการขายในช่วงนี้</p>
      ) : (
        <ol className="pos-dash-top-items">
          {products.topItems.map((row, idx) => (
            <li key={row.menuItemId}>
              <span className="pos-dash-rank">{idx + 1}</span>
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
          ))}
        </ol>
      )}
    </article>
  );
}
