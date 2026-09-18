"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { computeWasteRate, formatDeductRate } from "@/lib/prod-policy";
import {
  addProdProduct,
  updateProdProduct,
  type ProdProduct,
} from "@/lib/production";
import { DEFAULT_BAKERY_SALES_RATE } from "@/lib/rate-schedule";
import { formatPlainNumber } from "@/lib/utils";

/**
 * Super-slim owner popup — เพิ่มชื่อขนม + เรทผลิต
 * ปุ่มบันทึกอยู่ใน popup นี้เท่านั้น
 */
export function ProdAddProductModal({
  open,
  wasteBonusPct = 30,
  shopSalesRate,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  wasteBonusPct?: number;
  shopSalesRate?: number;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [pName, setPName] = useState("");
  const [prodRate, setProdRate] = useState("1.25");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const salesRate =
    shopSalesRate != null && Number.isFinite(shopSalesRate)
      ? shopSalesRate
      : DEFAULT_BAKERY_SALES_RATE;

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setPName("");
    setProdRate("1.25");
    setBusy(false);
    const t = window.setTimeout(() => nameRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = pName.trim();
    const rate = Number(prodRate);
    if (!name) {
      onError("ใส่ชื่อสินค้า");
      return;
    }
    if (!(rate >= 0)) {
      onError("ใส่เรทผลิต");
      return;
    }
    setBusy(true);
    try {
      await addProdProduct({ name, salesRate, prodRate: rate });
      onSaved();
      onClose();
    } catch (err) {
      onError((err as Error).message || "เพิ่มสินค้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop edit-modal is-prod-add-product"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-card prod-add-product-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prod-add-product-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prod-add-product-head">
          <h2 id="prod-add-product-title" className="prod-add-product-title">
            เพิ่มสินค้า
          </h2>
          <button
            type="button"
            className="ghost-btn icon-btn"
            aria-label="ปิด"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <form className="prod-add-product-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="prod-add-product-field">
            <span>ชื่อ</span>
            <input
              ref={nameRef}
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              placeholder="ขนมปัง…"
              required
              autoComplete="off"
            />
          </label>
          <label className="prod-add-product-field">
            <span>เรทผลิต</span>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={prodRate}
              onChange={(e) => setProdRate(e.target.value)}
              required
            />
          </label>
          <p className="muted prod-add-product-meta">
            ขาย {formatPlainNumber(salesRate)}
            {wasteBonusPct > 0
              ? ` · เสีย ${formatDeductRate(computeWasteRate(Number(prodRate) || 0, wasteBonusPct)) || "—"}/ทิ้ง`
              : ""}
          </p>
          <div className="prod-add-product-actions">
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ยกเลิก
            </button>
            <button
              type="submit"
              className="primary-btn"
              disabled={busy || !pName.trim()}
            >
              {busy ? "…" : "บันทึก"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * แคตตาล็อกสินค้าผลิต — รายการ + ขั้นต่ำ/เปิดปิด
 * เพิ่มชื่อใหม่ใช้ ProdAddProductModal เท่านั้น
 */
export function ProdCatalogSetup({
  products,
  wasteBonusPct = 30,
  onReload,
  onError,
}: {
  products: ProdProduct[];
  wasteBonusPct?: number;
  shopSalesRate?: number;
  onReload: () => void;
  onError: (msg: string) => void;
  /** @deprecated ใช้ปุ่ม +สินค้า ที่หัวหน้าแทน */
  onAddProduct?: () => void;
}) {
  return (
    <section className="prod-catalog-panel">
      <div className="prod-catalog-list-head">
        <h3 className="prod-catalog-list-title">
          รายการสินค้า ({products.length})
        </h3>
      </div>
      <p className="muted prod-catalog-lead">
        แก้เรท/ขั้นต่ำที่นี่ · เพิ่มชื่อใหม่กด +สินค้า ด้านบน
      </p>

      <div className="list-card prod-catalog-list">
        {products.length === 0 ? (
          <p className="empty">ยังไม่มีสินค้า — กด +สินค้า</p>
        ) : null}
        {products.map((p) => (
          <div key={p.id} className="list-row prod-catalog-row">
            <div className="prod-catalog-row-main">
              <strong>{p.name}</strong>
              <div className="muted prod-catalog-row-meta">
                ผลิต {formatPlainNumber(p.prodRate)}
                {wasteBonusPct > 0
                  ? ` · หัก ${formatDeductRate(computeWasteRate(p.prodRate, wasteBonusPct)) || "—"}/ทิ้ง (${wasteBonusPct}%)`
                  : ""}
                {!p.active ? " · ปิดใช้" : ""}
              </div>
            </div>
            <div className="prod-catalog-min">
              <label className="prod-catalog-min-label">
                ขั้นต่ำ/วัน
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  defaultValue={p.minQtyLow || ""}
                  key={`lo-${p.id}-${p.minQtyLow}`}
                  placeholder="—"
                  aria-label={`${p.name} ขั้นต่ำล่าง`}
                  onBlur={(e) => {
                    const next = Math.max(0, Number(e.target.value) || 0);
                    if (next === (p.minQtyLow || 0)) return;
                    void updateProdProduct(p.id, { minQtyLow: next })
                      .then(onReload)
                      .catch((err) => onError((err as Error).message || "อัปเดตไม่สำเร็จ"));
                  }}
                />
              </label>
              <span className="prod-catalog-min-sep">–</span>
              <label className="prod-catalog-min-label">
                ถึง
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  defaultValue={p.minQtyHigh || ""}
                  key={`hi-${p.id}-${p.minQtyHigh}`}
                  placeholder="—"
                  aria-label={`${p.name} ขั้นต่ำบน`}
                  onBlur={(e) => {
                    const next = Math.max(0, Number(e.target.value) || 0);
                    if (next === (p.minQtyHigh || 0)) return;
                    void updateProdProduct(p.id, { minQtyHigh: next })
                      .then(onReload)
                      .catch((err) => onError((err as Error).message || "อัปเดตไม่สำเร็จ"));
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                void updateProdProduct(p.id, { active: !p.active })
                  .then(onReload)
                  .catch((err) => onError((err as Error).message || "อัปเดตไม่สำเร็จ"))
              }
            >
              {p.active ? "ปิด" : "เปิด"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
