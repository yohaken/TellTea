"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  addMenuCategory,
  addMenuItem,
  listMenuCategories,
  seedPosMenuIfEmpty,
  subscribeMenuCategories,
  subscribeMenuItems,
  updateMenuCategory,
  updateMenuItem,
} from "@/lib/pos-menu";
import type { MenuCategory, MenuItem } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

export function MenuCatalogSetup({ onError }: { onError: (msg: string | null) => void }) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [catName, setCatName] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("45");
  const [itemCategoryId, setItemCategoryId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void seedPosMenuIfEmpty().catch((err) => onError((err as Error).message));
  }, [onError]);

  useEffect(() => {
    const unsubCat = subscribeMenuCategories(
      (list) => {
        setCategories(list);
        setLoading(false);
      },
      (err) => {
        onError(err.message);
        setLoading(false);
      },
    );
    const unsubItems = subscribeMenuItems(
      (list) => setItems(list),
      (err) => onError(err.message),
    );
    return () => {
      unsubCat();
      unsubItems();
    };
  }, [onError]);

  useEffect(() => {
    if (!itemCategoryId && categories.length) {
      setItemCategoryId(categories[0]!.id);
    }
  }, [categories, itemCategoryId]);

  async function onAddCategory(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await addMenuCategory(catName);
      setCatName("");
      await listMenuCategories().then(setCategories);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onAddItem(e: FormEvent) {
    e.preventDefault();
    if (!itemCategoryId) {
      onError("เพิ่มหมวดเมนูก่อน");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await addMenuItem({
        categoryId: itemCategoryId,
        name: itemName,
        price: Number(itemPrice),
      });
      setItemName("");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title">เมนู POS หน้าร้าน</h2>
      <p className="muted settings-card-lead">
        จัดการหมวดและรายการที่แสดงบนเครื่อง POS — พนักงานกดขายจากเมนูนี้
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <>
          <form className="pos-menu-form" onSubmit={(e) => void onAddCategory(e)}>
            <label>
              <span>หมวดใหม่</span>
              <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="เช่น ชา" required />
            </label>
            <button type="submit" className="ghost-btn" disabled={busy}>
              เพิ่มหมวด
            </button>
          </form>

          <form className="pos-menu-form" onSubmit={(e) => void onAddItem(e)}>
            <label>
              <span>ชื่อเมนู</span>
              <input value={itemName} onChange={(e) => setItemName(e.target.value)} required />
            </label>
            <label>
              <span>ราคา (บาท)</span>
              <input type="number" min="0" step="1" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} required />
            </label>
            <label>
              <span>หมวด</span>
              <select value={itemCategoryId} onChange={(e) => setItemCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="primary-btn" disabled={busy || !categories.length}>
              เพิ่มเมนู
            </button>
          </form>

          <ul className="pos-menu-owner-list">
            {categories.map((cat) => (
              <li key={cat.id}>
                <div className="pos-menu-owner-cat">
                  <strong>{cat.name}</strong>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() =>
                      void updateMenuCategory(cat.id, { active: !cat.active })
                        .catch((err) => onError(err.message))
                    }
                  >
                    {cat.active ? "ปิดหมวด" : "เปิดหมวด"}
                  </button>
                </div>
                <ul>
                  {items
                    .filter((i) => i.categoryId === cat.id)
                    .map((item) => (
                      <li key={item.id} className="pos-menu-owner-item">
                        <span>
                          {item.name} · ฿{formatPlainNumber(item.price)}
                          {!item.active ? " · ของหมด" : ""}
                        </span>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() =>
                            void updateMenuItem(item.id, { active: !item.active }).catch((err) =>
                              onError(err.message),
                            )
                          }
                        >
                          {item.active ? "ของหมด" : "เปิดขาย"}
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
