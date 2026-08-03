"use client";

import { ArrowDownToLine, PackageX } from "lucide-react";
import type { PosDashStockSummary } from "@/lib/pos-sales-dashboard";
import { formatPlainNumber } from "@/lib/utils";

export function PosSalesDashboardStock({
  stock,
  onOpenStock,
}: {
  stock: PosDashStockSummary;
  onOpenStock?: () => void;
}) {
  return (
    <article className="pos-dash-card pos-dash-card--stock">
      <div className="pos-dash-card-head">
        <h3 className="pos-dash-card-title">สินค้าคงคลัง</h3>
        {onOpenStock ? (
          <button type="button" className="npos-slim-text-btn pos-dash-more" onClick={onOpenStock}>
            ดูเพิ่มเติม
          </button>
        ) : null}
      </div>

      <div className="pos-dash-stock-split">
        <div className="pos-dash-stock-panel">
          <span className="pos-dash-stock-icon pos-dash-stock-icon--in" aria-hidden>
            <ArrowDownToLine size={18} strokeWidth={1.75} />
          </span>
          <span className="muted">มูลค่าเติมสินค้า</span>
          <strong className="pos-dash-stock-value">{formatPlainNumber(stock.inValue)} บาท</strong>
          <span className="muted">จำนวน {stock.inCount.toLocaleString("th-TH")} รายการ</span>
        </div>
        <div className="pos-dash-stock-panel">
          <span className="pos-dash-stock-icon pos-dash-stock-icon--out" aria-hidden>
            <PackageX size={18} strokeWidth={1.75} />
          </span>
          <span className="muted">มูลค่าเบิก/ปรับ</span>
          <strong className="pos-dash-stock-value">
            {formatPlainNumber(stock.outAdjustValue)} บาท
          </strong>
          <span className="muted">
            จำนวน {stock.outAdjustCount.toLocaleString("th-TH")} รายการ
            {stock.outCount || stock.adjustCount ? (
              <span className="pos-dash-stock-breakdown">
                {" "}
                (เบิก {stock.outCount} · ปรับ {stock.adjustCount})
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <p className="muted pos-dash-footnote">
        คำนวณจากประวัติสต็อก × ต้นทุนต่อหน่วย — ไม่แยกประเภทเสียหาย
      </p>
    </article>
  );
}
