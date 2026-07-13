"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Camera, Trash2 } from "lucide-react";
import { updateMenuItem } from "@/lib/pos-menu";
import { uploadPosMenuItemImage } from "@/lib/pos-storage";
import { PosSortableList } from "@/components/PosSortableList";
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
  const [imageUrl, setImageUrl] = useState(item.imageUrl || "");
  const [recommended, setRecommended] = useState(item.recommended === true);
  const [visibleOnPos, setVisibleOnPos] = useState(item.visibleOnPos !== false);
  const [active, setActive] = useState(item.active);
  const [linkedGroupIds, setLinkedGroupIds] = useState<string[]>(item.optionGroupIds || []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(item.name);
    setNameEn(item.nameEn || "");
    setCategoryId(item.categoryId);
    setPrice(String(item.price));
    setDescription(item.description || "");
    setImageUrl(item.imageUrl || "");
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

  async function onPickImage(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadPosMenuItemImage(item.id, file);
      setImageUrl(url);
      await updateMenuItem(item.id, { imageUrl: url });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    setImageUrl("");
    await updateMenuItem(item.id, { imageUrl: "" });
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
        imageUrl: imageUrl.trim() || undefined,
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

  const activeGroups = optionGroups.filter((g) => g.active);
  const linkedGroups = linkedGroupIds
    .map((id) => activeGroups.find((g) => g.id === id))
    .filter((g): g is MenuOptionGroup => g != null);
  const unlinkedGroups = activeGroups.filter((g) => !linkedGroupIds.includes(g.id));

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
        <div className="pos-menu-photo-block">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="pos-menu-photo-preview" />
          ) : (
            <div className="pos-menu-photo-placeholder">
              <Camera size={28} aria-hidden />
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="pos-menu-photo-input"
            onChange={(e) => void onPickImage(e.target.files?.[0] || null)}
          />
          <div className="pos-menu-photo-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "กำลังอัปโหลด..." : imageUrl ? "เปลี่ยนรูป" : "เพิ่มรูป"}
            </button>
            {imageUrl ? (
              <button type="button" className="ghost-btn" onClick={() => void removeImage()}>
                ลบรูป
              </button>
            ) : null}
          </div>
        </div>

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
          <span>ราคาหน้าร้าน (฿)</span>
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
          {linkedGroups.length > 1 ? (
            <>
              <p className="muted pos-menu-sort-hint">ลากเรียงลำดับที่แสดงตอนขาย</p>
              <PosSortableList
                ids={linkedGroupIds}
                onReorder={setLinkedGroupIds}
                className="pos-menu-link-groups-sort"
                renderItem={(gid) => {
                  const g = activeGroups.find((x) => x.id === gid);
                  return g ? <span>{g.name}</span> : null;
                }}
              />
            </>
          ) : null}
          <ul className="pos-menu-link-groups">
            {unlinkedGroups.map((g) => (
              <li key={g.id}>
                <label className="pos-menu-toggle-row">
                  <span>{g.name}</span>
                  <input type="checkbox" checked={false} onChange={() => toggleGroup(g.id)} />
                </label>
              </li>
            ))}
            {linkedGroups.map((g) => (
              <li key={g.id}>
                <label className="pos-menu-toggle-row">
                  <span>{g.name}</span>
                  <input type="checkbox" checked onChange={() => toggleGroup(g.id)} />
                </label>
              </li>
            ))}
            {!activeGroups.length ? (
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
          ราคาหน้าร้าน ฿{formatPlainNumber(Number(price) || 0)}
        </p>

        <button type="submit" className="primary-btn pos-menu-save-btn" disabled={busy || uploading}>
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </form>
    </div>
  );
}
