"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  adjustStockQty,
  createStockItem,
  deleteStockItem,
  listStockItems,
  setStockQty,
} from "@/lib/stock";
import type { StockItem } from "@/lib/types";

export default function StockPage() {
  return (
    <AuthGate>
      <StockView />
    </AuthGate>
  );
}

function StockView() {
  const { user, staff } = useAuth();
  const isOwner = staff?.role === "owner";
  const canUseStock = can(staff, "stock");
  const [items, setItems] = useState<StockItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ถุง");
  const [qty, setQty] = useState("0");
  const [minQty, setMinQty] = useState("0");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listStockItems());
    } catch (err) {
      setError((err as Error).message || "โหลดสต็อกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      await createStockItem({
        name,
        unit,
        qty: Number(qty),
        minQty: Number(minQty),
        updatedBy: user.email,
      });
      setName("");
      setQty("0");
      setMinQty("0");
      await reload();
    } catch (err) {
      setError((err as Error).message || "เพิ่มของไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function bump(id: string, delta: number) {
    if (!user?.email) return;
    setError(null);
    try {
      await adjustStockQty(id, delta, user.email);
      await reload();
    } catch (err) {
      setError((err as Error).message || "ปรับจำนวนไม่สำเร็จ");
    }
  }

  async function onSetQty(id: string, value: string) {
    if (!user?.email) return;
    setError(null);
    try {
      await setStockQty(id, Number(value), user.email);
      await reload();
    } catch (err) {
      setError((err as Error).message || "ตั้งจำนวนไม่สำเร็จ");
    }
  }

  if (!canUseStock) {
    return (
      <div>
        <h1 className="panel-title">สต็อกเบาๆ</h1>
        <p className="empty">ไม่มีสิทธิ์ดูสต็อก</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="panel-title">สต็อกเบาๆ</h1>
      <p className="muted" style={{ marginBottom: "0.85rem", textAlign: "left" }}>
        ของใช้ประจำร้าน เช่น น้ำแข็ง แก้ว หลอด — กด +/− ได้เลย ไม่ใช่ระบบคลังเต็มรูปแบบ
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      {isOwner ? (
        <form className="form-card" onSubmit={(e) => void onCreate(e)}>
          <div className="field">
            <label htmlFor="stock-name">ชื่อของ</label>
            <input
              id="stock-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ค่าน้ำแข็ง / แก้ว 22oz"
              required
            />
          </div>
          <div className="stock-form-grid">
            <div className="field">
              <label htmlFor="stock-unit">หน่วย</label>
              <input id="stock-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="stock-qty">จำนวนเริ่ม</label>
              <input
                id="stock-qty"
                type="number"
                step="0.01"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="stock-min">เตือนเมื่อ ≤</label>
              <input
                id="stock-min"
                type="number"
                step="0.01"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังเพิ่ม..." : "เพิ่มรายการ"}
          </button>
        </form>
      ) : null}

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && items.length === 0 ? (
        <p className="empty">
          {isOwner ? "ยังไม่มีของในสต็อก — เพิ่มรายการด้านบน" : "ยังไม่มีของในสต็อก ให้เจ้าของเพิ่มก่อน"}
        </p>
      ) : (
        <div className="list-card stock-list">
          {items.map((item) => {
            const low = item.minQty > 0 && item.qty <= item.minQty;
            return (
              <div key={item.id} className={`stock-row ${low ? "is-low" : ""}`}>
                <div className="stock-main">
                  <strong>{item.name}</strong>
                  <div className="muted">
                    {item.qty} {item.unit}
                    {low ? " · ใกล้หมด" : ""}
                  </div>
                </div>
                <div className="stock-actions">
                  <button type="button" className="qty-btn" onClick={() => void bump(item.id, -1)}>
                    −
                  </button>
                  <input
                    className="stock-qty-input"
                    type="number"
                    step="0.01"
                    defaultValue={item.qty}
                    key={`${item.id}-${item.qty}`}
                    onBlur={(e) => {
                      if (Number(e.target.value) !== item.qty) {
                        void onSetQty(item.id, e.target.value);
                      }
                    }}
                  />
                  <button type="button" className="qty-btn" onClick={() => void bump(item.id, 1)}>
                    +
                  </button>
                  {isOwner ? (
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={() =>
                        void deleteStockItem(item.id)
                          .then(reload)
                          .catch((err) => setError(err.message || "ลบไม่สำเร็จ"))
                      }
                    >
                      ลบ
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
