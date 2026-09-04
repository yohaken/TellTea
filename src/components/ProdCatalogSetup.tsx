"use client";

import { useState, type FormEvent } from "react";
import { computeWasteRate, formatDeductRate } from "@/lib/prod-policy";
import {
  addProdProduct,
  updateProdProduct,
  type ProdProduct,
} from "@/lib/production";
import { DEFAULT_BAKERY_SALES_RATE } from "@/lib/rate-schedule";
import { formatPlainNumber } from "@/lib/utils";

/**
 * แคตตาล็อกสินค้าผลิต + เรทผลิตเริ่มต้น — เจ้าของเท่านั้น
 * เรทขายทั้งร้านตั้งที่สรุปโบนัส → ตารางเรท เท่านั้น
 */
export function ProdCatalogSetup({
  products,
  wasteBonusPct = 30,
  shopSalesRate,
  onReload,
  onError,
}: {
  products: ProdProduct[];
  /** % เรทเสียจากนโยบาย — โชว์คู่เรทผลิต */
  wasteBonusPct?: number;
  /** เรทขายปัจจุบันจากตารางเรท (แหล่งเดียว) */
  shopSalesRate?: number;
  onReload: () => void;
  onError: (msg: string) => void;
}) {
  const [pName, setPName] = useState("");
  const [prodRate, setProdRate] = useState("1.25");
  const [busy, setBusy] = useState(false);
  const salesRate =
    shopSalesRate != null && Number.isFinite(shopSalesRate)
      ? shopSalesRate
      : DEFAULT_BAKERY_SALES_RATE;

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addProdProduct({
        name: pName,
        salesRate,
        prodRate: Number(prodRate),
      });
      setPName("");
      onReload();
    } catch (err) {
      onError((err as Error).message || "เพิ่มสินค้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="prod-catalog-panel">
      <p className="muted prod-catalog-lead">
        เพิ่มสินค้า + เรทผลิต · ขั้นต่ำต่อวัน (เช่น 30–60 ชิ้น/วัน) ว่าง = ไม่มีนโยบาย · เรทขายทั้งร้านตั้งที่{" "}
        <a href="/bonus/" style={{ fontWeight: 700 }}>
          สรุปโบนัส → ตารางเรท
        </a>
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void addProduct(e)}>
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>
          สินค้า + เรทผลิต
        </h3>
        <div className="field">
          <label htmlFor="setup-pname">ชื่อสินค้า</label>
          <input
            id="setup-pname"
            value={pName}
            onChange={(e) => setPName(e.target.value)}
            placeholder="เช่น วาฟเฟิล"
            required
          />
        </div>
        <p className="muted form-hint-inline">
          เรทขายทั้งร้านตอนนี้ {formatPlainNumber(salesRate)} บาท/หน่วย (จากตารางเรท)
        </p>
        <div className="field">
          <label htmlFor="setup-prod">เรทผลิต</label>
          <input
            id="setup-prod"
            type="number"
            step="0.01"
            min="0"
            value={prodRate}
            onChange={(e) => setProdRate(e.target.value)}
          />
        </div>
        {wasteBonusPct > 0 ? (
          <p className="muted form-hint-inline">
            เรทเสีย {formatDeductRate(computeWasteRate(Number(prodRate) || 0, wasteBonusPct)) || "—"}
            /ชิ้นทิ้ง · ไม่มีทิ้ง = ×0{" "}
            ({wasteBonusPct}% ของเรทผลิต)
          </p>
        ) : null}
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังเพิ่ม..." : "เพิ่มสินค้า"}
        </button>
      </form>

      <div className="list-card" style={{ marginTop: "0.75rem" }}>
        <h3 className="panel-title" style={{ fontSize: "0.95rem" }}>
          รายการสินค้า ({products.length})
        </h3>
        {products.length === 0 ? (
          <p className="empty">ยังไม่มีสินค้า — เพิ่มด้านบน</p>
        ) : null}
        {products.map((p) => (
          <div key={p.id} className="list-row prod-catalog-row">
            <div className="prod-catalog-row-main">
              <strong>{p.name}</strong>
              <div className="muted prod-catalog-row-meta">
                ผลิต {formatPlainNumber(p.prodRate)}
                {wasteBonusPct > 0
                  ? ` · หัก ${formatDeductRate(computeWasteRate(p.prodRate, wasteBonusPct)) || "—"}/ชิ้นทิ้ง (${wasteBonusPct}%)`
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
