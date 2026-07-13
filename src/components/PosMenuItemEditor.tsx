"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { updateMenuItem } from "@/lib/pos-menu";
import type { MenuCategory, MenuItem, MenuOptionGroup } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

export function PosMenuItemEditor({
  item,
  categories,
  optionGroups,
  onBack,
  onSaved,
  onDelete,
}: {
  item: MenuItem;
  categories: MenuCategory[];
  optionGroups: MenuOptionGroup[];
  onBack: () => void;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [nameEn, setNameEn] = useState(item.nameEn || "");
  const [categoryId, setCategoryId] = useState(item.categoryId);
  const [price, setPrice] = useState(String(item.price));
  const [description, setDescription] = useState(item.description || "");
  const [recommended, setRecommended] = useState(item.recommended === true);
  const [visibleOnPos, setVisibleOnPos] = useState(item.visibleOnPos !== false);
  const [active, setActive] = useState(item.active);
  const [linkedGroupIds, setLinkedGroupIds] = useState<string[]>(item.optionGroupIds || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(item.name);
    setNameEn(item.nameEn || "");
    setCategoryId(item.categoryId);
    setPrice(String(item.price));
    setDescription(item.description || "");
    setRecommended(item.recommended === true);
    setVisibleOnPos(item.visibleOnPos !== false);
    setActive(item.active);
    setLinkedGroupIds(item.optionGroupIds || []);
  }, [item]);

  function toggleGroup(id: string) {
    setLinkedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateMenuItem(item.id, {
        name,
        nameEn: nameEn.trim() || undefined,
        categoryId,
        price: Number(price) || 0,
        description: description.trim() || undefined,
        recommended,
        visibleOnPos,
        active,
        optionGroupIds: linkedGroupIds,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-menu-admin-screen">
      <header className="pos-menu-admin-head">
        <button type="button" className="ghost-btn pos-menu-back" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden />
          กลับ
        </button>
        <h1>แก้ไขเมนู</h1>
      </header>

      <form className="pos-menu-editor-form" onSubmit={(e) => void onSave(e)}>
        <label>
          <span>ชื่อเมนู (ภาษาไทย)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </label>
        <label>
          <span>ชื่อเมนู (ภาษาอังกฤษ)</span>
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={100} />
        </label>
        <label>
          <span>หมวดหมู่</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>ราคา (฿)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </label>

        <div className="pos-menu-field-block">
          <div className="pos-menu-options-head">
            <h2>กลุ่มตัวเลือก</h2>
          </div>
          <ul className="pos-menu-link-groups">
            {optionGroups
              .filter((g) => g.active)
              .map((g) => (
                <li key={g.id}>
                  <label className="pos-menu-toggle-row">
                    <span>{g.name}</span>
                    <input
                      type="checkbox"
                      checked={linkedGroupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                  </label>
                </li>
              ))}
            {!optionGroups.length ? (
              <li className="muted">ยังไม่มีกลุ่มตัวเลือก — สร้างจากแท็บกลุ่มตัวเลือก</li>
            ) : null}
          </ul>
        </div>

        <label className="pos-menu-toggle-row">
          <span>เมนูแนะนำ</span>
          <input type="checkbox" checked={recommended} onChange={(e) => setRecommended(e.target.checked)} />
        </label>
        <label className="pos-menu-toggle-row">
          <span>แสดงเมนูบนหน้าจอขาย</span>
          <input
            type="checkbox"
            checked={visibleOnPos}
            onChange={(e) => setVisibleOnPos(e.target.checked)}
          />
        </label>
        <label className="pos-menu-toggle-row">
          <span>เปิดขาย (ไม่ใช่ของหมด)</span>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        </label>

        <label>
          <span>คำอธิบายเมนู</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="button" className="ghost-btn pos-menu-delete-btn" onClick={() => void onDelete()}>
          <Trash2 size={15} aria-hidden /> ลบเมนู
        </button>

        <p className="muted pos-menu-price-hint">
          ราคาปัจจุบัน ฿{formatPlainNumber(Number(price) || 0)}
        </p>

        <button type="submit" className="primary-btn pos-menu-save-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </form>
    </div>
  );
}
