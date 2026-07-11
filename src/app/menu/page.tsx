"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AuthGate } from "@/components/AuthGate";
import {
  createMenuItem,
  deleteMenuItem,
  listMenuItems,
  updateMenuItem,
} from "@/lib/menu";
import type { MenuItem } from "@/lib/types";
import { formatBaht } from "@/lib/utils";

export default function MenuPage() {
  return (
    <AuthGate>
      <MenuView />
    </AuthGate>
  );
}

function MenuView() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("ชา");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setItems(await listMenuItems());
  }

  useEffect(() => {
    void reload().catch((err) => setError(err.message || "โหลดเมนูไม่สำเร็จ"));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createMenuItem({
        name,
        price: Number(price),
        category,
        available: true,
      });
      setName("");
      setPrice("");
      await reload();
    } catch (err) {
      setError((err as Error).message || "เพิ่มเมนูไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="panel-title">เมนู</h1>
      {error ? <p className="error-text">{error}</p> : null}

      <form className="form-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="name">ชื่อเมนู</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น ชาไทยเย็น"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="price">ราคา (บาท)</label>
          <input
            id="price"
            type="number"
            min="0"
            step="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="category">หมวด</label>
          <input
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="ชา / นม / ท็อปปิ้ง"
          />
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "เพิ่มเมนู"}
        </button>
      </form>

      <div className="list-card" style={{ marginTop: "1rem" }}>
        {items.length === 0 ? (
          <p className="empty">ยังไม่มีเมนู</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="list-row">
              <div>
                <strong>{item.name}</strong>
                <div className="muted">
                  {formatBaht(item.price)} · {item.category}
                  {item.available ? "" : " · ปิดขาย"}
                </div>
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() =>
                    void updateMenuItem(item.id, { available: !item.available }).then(reload)
                  }
                >
                  {item.available ? "ปิดขาย" : "เปิดขาย"}
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => void deleteMenuItem(item.id).then(reload)}
                >
                  ลบ
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
