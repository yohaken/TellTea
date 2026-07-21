"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  adjustStockQty,
  createStockItem,
  deleteStockItem,
  seedStockItemsIfEmpty,
  subscribeStockItems,
  updateStockItem,
} from "@/lib/stock";
import type { StockItem } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

/**
 * รายการวัตถุดิบ — เจ้าของเท่านั้น
 * ใช้ในหน้าคลัง (/stock) มุมมองรายการ · ตั้งชื่อ · เพิ่ม/ลดคงเหลือ · ลบ
 */
export function StockCatalogSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const userEmail = actorId;
  const [items, setItems] = useState<StockItem[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ชิ้น");
  const [minQty, setMinQty] = useState("0");
  const [safetyStock, setSafetyStock] = useState("0");
  const [unitCost, setUnitCost] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [qtyBusyId, setQtyBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!userEmail) return;
    void seedStockItemsIfEmpty(userEmail).catch(() => undefined);
    const unsub = subscribeStockItems(
      (rows) => setItems(rows),
      (err) => onError(err.message),
    );
    return unsub;
  }, [userEmail, onError]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!userEmail) return;
    setBusy(true);
    onError(null);
    try {
      await createStockItem({
        name,
        unit,
        qty: 0,
        minQty: Number(minQty),
        safetyStock: Number(safetyStock),
        unitCost: Number(unitCost),
        barcode,
        updatedBy: userEmail,
      });
      setName("");
      setBarcode("");
    } catch (err) {
      onError((err as Error).message || "เพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function saveField(item: StockItem, field: keyof StockItem, value: string) {
    if (!userEmail) return;
    onError(null);
    try {
      const patch: Record<string, unknown> = { updatedBy: userEmail };
      if (field === "name") patch.name = value;
      if (field === "unit") patch.unit = value;
      if (field === "minQty") patch.minQty = Number(value);
      if (field === "safetyStock") patch.safetyStock = Number(value);
      if (field === "unitCost") patch.unitCost = Number(value);
      if (field === "barcode") patch.barcode = value;
      await updateStockItem(item.id, patch as Parameters<typeof updateStockItem>[1]);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    }
  }

  async function onAdjustQty(item: StockItem, delta: number) {
    if (!userEmail || qtyBusyId) return;
    if (delta < 0 && item.qty <= 0) return;
    setQtyBusyId(item.id);
    onError(null);
    try {
      await adjustStockQty(item.id, delta, userEmail);
    } catch (err) {
      onError((err as Error).message || "ปรับจำนวนไม่สำเร็จ");
    } finally {
      setQtyBusyId(null);
    }
  }

  async function onDelete(item: StockItem) {
    if (!window.confirm(`ลบ「${item.name}」ออกจากคลัง?`)) return;
    onError(null);
    try {
      await deleteStockItem(item.id);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  return (
    <section className="stock-catalog-panel">
      <p className="muted stock-catalog-lead">
        จัดการรายการวัตถุดิบ — ตั้งชื่อ · เพิ่ม/ลดคงเหลือ · ลบ · เฉพาะเจ้าของ
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void onCreate(e)}>
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>
          เพิ่มวัตถุดิบ
        </h3>
        <div className="field">
          <label htmlFor="stock-setup-name">ชื่อ</label>
          <input
            id="stock-setup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น แก้วชา"
            required
          />
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="stock-setup-unit">หน่วย</label>
            <input id="stock-setup-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="stock-setup-reorder">จุดสั่งซื้อ</label>
            <input
              id="stock-setup-reorder"
              type="number"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="stock-setup-safety">สต๊อกสำรอง</label>
            <input
              id="stock-setup-safety"
              type="number"
              value={safetyStock}
              onChange={(e) => setSafetyStock(e.target.value)}
            />
          </div>
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="stock-setup-cost">ราคา/หน่วย (บาท)</label>
            <input
              id="stock-setup-cost"
              type="number"
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="stock-setup-barcode">บาร์โค้ด</label>
            <input
              id="stock-setup-barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังเพิ่ม..." : "เพิ่มรายการ"}
        </button>
      </form>

      <div className="list-card stock-setup-list">
        <h3 className="panel-title" style={{ fontSize: "0.95rem" }}>
          รายการวัตถุดิบ ({items.length})
        </h3>
        {items.length === 0 ? <p className="empty">ยังไม่มีรายการ — เพิ่มด้านบน</p> : null}
        {items.map((item) => {
          const qtyBusy = qtyBusyId === item.id;
          return (
            <div key={item.id} className="stock-setup-row">
              <input
                className="stock-setup-name"
                defaultValue={item.name}
                key={`name-${item.id}-${item.name}`}
                aria-label={`ชื่อ ${item.name}`}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== item.name) void saveField(item, "name", next);
                  else if (!next) e.target.value = item.name;
                }}
              />

              <div className="stock-qty-stepper" aria-label={`คงเหลือ ${item.name}`}>
                <button
                  type="button"
                  className="stock-qty-btn"
                  disabled={qtyBusy || item.qty <= 0}
                  aria-label="ลด 1"
                  onClick={() => void onAdjustQty(item, -1)}
                >
                  <Minus size={16} aria-hidden />
                </button>
                <div className="stock-qty-value">
                  <strong>{formatPlainNumber(item.qty)}</strong>
                  <span className="muted">{item.unit}</span>
                </div>
                <button
                  type="button"
                  className="stock-qty-btn"
                  disabled={qtyBusy}
                  aria-label="เพิ่ม 1"
                  onClick={() => void onAdjustQty(item, 1)}
                >
                  <Plus size={16} aria-hidden />
                </button>
              </div>

              <div className="stock-setup-grid">
                <label>
                  หน่วย
                  <input
                    defaultValue={item.unit}
                    key={`unit-${item.id}-${item.unit}`}
                    onBlur={(e) => {
                      if (e.target.value !== item.unit) void saveField(item, "unit", e.target.value);
                    }}
                  />
                </label>
                <label>
                  สั่งซื้อ ≤
                  <input
                    type="number"
                    defaultValue={item.minQty}
                    key={`min-${item.id}-${item.minQty}`}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== item.minQty) {
                        void saveField(item, "minQty", e.target.value);
                      }
                    }}
                  />
                </label>
                <label>
                  สำรอง
                  <input
                    type="number"
                    defaultValue={item.safetyStock}
                    key={`safe-${item.id}-${item.safetyStock}`}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== item.safetyStock) {
                        void saveField(item, "safetyStock", e.target.value);
                      }
                    }}
                  />
                </label>
                <label>
                  ฿/หน่วย
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={item.unitCost}
                    key={`cost-${item.id}-${item.unitCost}`}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== item.unitCost) {
                        void saveField(item, "unitCost", e.target.value);
                      }
                    }}
                  />
                </label>
                <label className="wide">
                  บาร์โค้ด
                  <input
                    defaultValue={item.barcode || ""}
                    key={`bc-${item.id}-${item.barcode || ""}`}
                    onBlur={(e) => {
                      if (e.target.value !== (item.barcode || "")) {
                        void saveField(item, "barcode", e.target.value);
                      }
                    }}
                  />
                </label>
              </div>

              <div className="stock-setup-meta">
                <span className="muted">แตะชื่อเพื่อแก้ · ± ปรับคงเหลือ</span>
                <button
                  type="button"
                  className="danger-btn stock-setup-delete"
                  onClick={() => void onDelete(item)}
                >
                  <Trash2 size={14} aria-hidden />
                  ลบ
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
