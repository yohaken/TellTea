"use client";

import { useState, type FormEvent } from "react";
import {
  addProdProduct,
  updateProdProduct,
  type ProdProduct,
} from "@/lib/production";
import { formatPlainNumber } from "@/lib/utils";

export function ProdCatalogSetup({
  products,
  onReload,
  onError,
}: {
  products: ProdProduct[];
  onReload: () => void;
  onError: (msg: string) => void;
}) {
  const [pName, setPName] = useState("");
  const [salesRate, setSalesRate] = useState("0.60");
  const [prodRate, setProdRate] = useState("1.25");
  const [busy, setBusy] = useState(false);

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addProdProduct({
        name: pName,
        salesRate: Number(salesRate),
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
    <section className="owner-settings-section">
      <h2 className="owner-settings-title">ผลิต / โบนัสเบเกอรี่</h2>
      <p className="muted owner-settings-hint">
        เพิ่มสินค้า + เรทเริ่มต้นที่นี่ · ปรับเรทตามวันได้ที่{" "}
        <a href="/bonus/" style={{ fontWeight: 700 }}>สรุปโบนัส → ตารางเรท</a>
        {" "}· โบนัส/คน = ผลิต × เรทผลิต ÷ จำนวนคน · พนักงานอยู่ที่{" "}
        <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void addProduct(e)}>
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>สินค้า + เรท</h3>
        <div className="field">
          <label htmlFor="setup-pname">ชื่อสินค้า</label>
          <input id="setup-pname" value={pName} onChange={(e) => setPName(e.target.value)} required />
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="setup-sales">เรทขาย</label>
            <input id="setup-sales" type="number" step="0.01" min="0" value={salesRate} onChange={(e) => setSalesRate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="setup-prod">เรทผลิต</label>
            <input id="setup-prod" type="number" step="0.01" min="0" value={prodRate} onChange={(e) => setProdRate(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>เพิ่มสินค้า</button>
      </form>

      <div className="list-card" style={{ marginTop: "0.75rem" }}>
        {products.map((p) => (
          <div key={p.id} className="list-row" style={{ flexWrap: "wrap", gap: "0.45rem" }}>
            <div style={{ flex: 1, minWidth: "8rem" }}>
              <strong>{p.name}</strong>
              <div className="muted" style={{ fontSize: "0.78rem" }}>
                ขาย {formatPlainNumber(p.salesRate)} · ผลิต {formatPlainNumber(p.prodRate)}
                {!p.active ? " · ปิดใช้" : ""}
              </div>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                void updateProdProduct(p.id, { active: !p.active })
                  .then(onReload)
                  .catch((err) => onError(err.message || "อัปเดตไม่สำเร็จ"))
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
