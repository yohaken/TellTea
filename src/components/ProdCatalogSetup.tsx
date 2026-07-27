"use client";

import { useState, type FormEvent } from "react";
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
  shopSalesRate,
  onReload,
  onError,
}: {
  products: ProdProduct[];
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
        เพิ่มสินค้า + เรทผลิต · เรทขายทั้งร้านตั้งที่{" "}
        <a href="/bonus/" style={{ fontWeight: 700 }}>
          สรุปโบนัส → ตารางเรท
        </a>
        {" "}เท่านั้น · โบนัส/คน = ผลิต × เรทผลิต ÷ จำนวนคน
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
          <div key={p.id} className="list-row" style={{ flexWrap: "wrap", gap: "0.45rem" }}>
            <div style={{ flex: 1, minWidth: "8rem" }}>
              <strong>{p.name}</strong>
              <div className="muted" style={{ fontSize: "0.78rem" }}>
                ผลิต {formatPlainNumber(p.prodRate)}
                {!p.active ? " · ปิดใช้" : ""}
              </div>
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
