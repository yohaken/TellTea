"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { updateMenuItem } from "@/lib/pos-menu";
import type { MenuImageCropSource } from "@/lib/pos-menu-image";
import { PosMenuImageCropModal } from "@/components/PosMenuImageCropModal";
import { PosMenuPhotoModule } from "@/components/PosMenuPhotoModule";
import { PosSortableList } from "@/components/PosSortableList";
import type { MenuCategory, MenuItem, MenuOptionGroup } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";
import { selectionTypeLabel } from "@/lib/pos-menu-option-summary";

function hydrateEditorState(item: MenuItem) {
  return {
    name: item.name,
    nameEn: item.nameEn || "",
    code: item.code || "",
    categoryId: item.categoryId,
    price: String(item.price),
    deliveryPrice: typeof item.deliveryPrice === "number" ? String(item.deliveryPrice) : "",
    description: item.description || "",
    imageUrl: item.imageUrl || "",
    recommended: item.recommended === true,
    visibleOnPos: item.visibleOnPos !== false,
    /** Treat missing active as on — never coerce undefined → off (shows as หมด). */
    active: item.active !== false,
    linkedGroupIds: item.optionGroupIds || [],
  };
}

export function PosMenuItemEditor({
  item,
  categories,
  optionGroups,
  onBack,
  onSaved,
  onDelete,
  modal = false,
  /** Prefer this category when opening a freshly created item (avoids select jumping to first/bakery). */
  preferredCategoryId,
}: {
  item: MenuItem;
  categories: MenuCategory[];
  optionGroups: MenuOptionGroup[];
  onBack: () => void;
  onSaved: () => void;
  onDelete: () => void;
  modal?: boolean;
  preferredCategoryId?: string | null;
}) {
  const initial = hydrateEditorState(item);
  const [name, setName] = useState(initial.name);
  const [nameEn, setNameEn] = useState(initial.nameEn);
  const [code, setCode] = useState(initial.code);
  const [categoryId, setCategoryId] = useState(
    preferredCategoryId || initial.categoryId,
  );
  const [price, setPrice] = useState(initial.price);
  const [deliveryPrice, setDeliveryPrice] = useState(initial.deliveryPrice);
  const [description, setDescription] = useState(initial.description);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [recommended, setRecommended] = useState(initial.recommended);
  const [visibleOnPos, setVisibleOnPos] = useState(initial.visibleOnPos);
  const [active, setActive] = useState(initial.active);
  const [linkedGroupIds, setLinkedGroupIds] = useState<string[]>(initial.linkedGroupIds);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropSource, setCropSource] = useState<MenuImageCropSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only re-hydrate when switching to another menu — snapshot churn must not wipe local edits
  // (category jump / พร้อมขาย flipping off while linking groups).
  useEffect(() => {
    const next = hydrateEditorState(item);
    setName(next.name);
    setNameEn(next.nameEn);
    setCode(next.code);
    setCategoryId(preferredCategoryId || next.categoryId);
    setPrice(next.price);
    setDeliveryPrice(next.deliveryPrice);
    setDescription(next.description);
    setImageUrl(next.imageUrl);
    setRecommended(next.recommended);
    setVisibleOnPos(next.visibleOnPos);
    setActive(next.active);
    setLinkedGroupIds(next.linkedGroupIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: item.id only
  }, [item.id, preferredCategoryId]);

  const categoryOptions = useMemo(() => {
    const activeCats = categories.filter((c) => c.active !== false);
    const list = activeCats.length ? activeCats : categories;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const current = byId.get(categoryId);
    const ordered = [...list].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"),
    );
    if (current && !ordered.some((c) => c.id === current.id)) {
      return [current, ...ordered];
    }
    return ordered;
  }, [categories, categoryId]);

  function toggleGroup(id: string) {
    setLinkedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function applyImageUrl(url: string) {
    setImageUrl(url);
    await updateMenuItem(item.id, { imageUrl: url });
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
        code: code.trim() || null,
        categoryId,
        price: Number(price) || 0,
        deliveryPrice:
          deliveryPrice.trim() === "" ? null : Math.max(0, Number(deliveryPrice) || 0),
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

  const activeGroups = optionGroups.filter((g) => g.active !== false);
  const linkedGroups = linkedGroupIds
    .map((id) => activeGroups.find((g) => g.id === id))
    .filter((g): g is MenuOptionGroup => g != null);
  const unlinkedGroups = activeGroups.filter((g) => !linkedGroupIds.includes(g.id));
  const deliveryEffective =
    deliveryPrice.trim() === "" ? Number(price) || 0 : Number(deliveryPrice) || 0;

  return (
    <div className={modal ? "pos-menu-editor-modal" : "pos-menu-admin-screen"}>
      {!modal ? (
        <header className="pos-menu-admin-head">
          <button type="button" className="ghost-btn pos-menu-back" onClick={onBack}>
            <ArrowLeft size={18} aria-hidden />
            กลับ
          </button>
          <h1>แก้ไขเมนู</h1>
        </header>
      ) : null}

      <form className="pos-menu-editor-form pos-menu-editor-form--frame" onSubmit={(e) => void onSave(e)}>
        <div className="pos-menu-editor-grid">
          <aside className="pos-menu-editor-media" aria-label="รูปและแท็ก">
            <PosMenuPhotoModule
              imageUrl={imageUrl}
              recommended={recommended}
              onRecommendedChange={setRecommended}
              uploading={uploading}
              setUploading={setUploading}
              onImageReady={applyImageUrl}
              onRequestCrop={setCropSource}
              onRemove={removeImage}
              onError={(msg) => setError(msg || null)}
            />
          </aside>

          <div className="pos-menu-editor-fields">
            <section className="pos-menu-editor-card" aria-label="รายละเอียด">
              <h2 className="pos-menu-editor-card-title">รายละเอียด</h2>

              <div className="pos-menu-editor-name-row">
                <label>
                  <span>
                    ชื่อ <abbr title="จำเป็น">*</abbr>
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                    placeholder="ชื่อเมนูภาษาไทย"
                  />
                </label>
                <label>
                  <span>ชื่อ 2</span>
                  <input
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    maxLength={100}
                    placeholder="English name"
                  />
                </label>
              </div>

              <div className="pos-menu-editor-meta-row">
                <label>
                  <span>หมวดหมู่</span>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    required
                  >
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.active === false ? " (เก็บแล้ว)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>รหัสเมนู</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={40}
                    placeholder="เช่น KO-01"
                  />
                </label>
              </div>

              <div className="pos-menu-switch-row">
                <span>
                  <strong>พร้อมขาย</strong>
                  <span className="muted"> เปิดขายบนเคาน์เตอร์ (ไม่ใช่ของหมด)</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  aria-label="พร้อมขาย"
                />
              </div>

              <div className="pos-menu-switch-row">
                <span>
                  <strong>แสดงบนหน้าจอขาย</strong>
                  <span className="muted"> ซ่อนจากกริดขายได้โดยไม่เก็บเข้าคลัง</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={visibleOnPos}
                  onChange={(e) => setVisibleOnPos(e.target.checked)}
                  aria-label="แสดงเมนูบนหน้าจอขาย"
                />
              </div>

              <label>
                <span>รายละเอียดเมนู</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="ส่วนประกอบ · ระดับความหวาน · หมายเหตุให้พนักงาน"
                />
              </label>
            </section>

            <section className="pos-menu-editor-card" aria-label="ช่องทางในการขาย">
              <h2 className="pos-menu-editor-card-title">ช่องทางในการขาย</h2>
              <p className="muted pos-menu-price-dual-hint">
                ตั้งราคาแยกหน้าร้านกับเดลิเวอรี่ · ว่าง = ใช้หน้าร้าน · placeholder «ส่ง» · ใส่ 0
                ถ้าต้องการราคาเดลิเป็นศูนย์จริง
              </p>
              <div className="pos-menu-channel-table" role="table" aria-label="ราคาตามช่องทาง">
                <div className="pos-menu-channel-head" role="row">
                  <span role="columnheader">ช่องทาง</span>
                  <span role="columnheader">ราคาในร้าน</span>
                  <span role="columnheader">ราคาขายจริง</span>
                </div>
                <div className="pos-menu-channel-row" role="row">
                  <span className="pos-menu-channel-name" role="cell">
                    หน้าร้าน (nPos)
                  </span>
                  <label className="pos-menu-channel-price" role="cell">
                    <span className="sr-only">ราคาหน้าร้าน</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      required
                      aria-label="ราคาหน้าร้าน"
                    />
                  </label>
                  <span className="pos-menu-channel-effective" role="cell">
                    ฿{formatPlainNumber(Number(price) || 0)}
                  </span>
                </div>
                <div className="pos-menu-channel-row" role="row">
                  <span className="pos-menu-channel-name" role="cell">
                    เดลิเวอรี่
                  </span>
                  <label className="pos-menu-channel-price" role="cell">
                    <span className="sr-only">ราคาเดลิเวอรี่</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={deliveryPrice}
                      onChange={(e) => setDeliveryPrice(e.target.value)}
                      placeholder="ส่ง"
                      title="ว่าง = ใช้ราคาหน้าร้าน"
                      aria-label="ราคาเดลิเวอรี่"
                    />
                  </label>
                  <span className="pos-menu-channel-effective" role="cell">
                    ฿{formatPlainNumber(deliveryEffective)}
                  </span>
                </div>
              </div>
              {/* Keep dual-price class hook for existing tests */}
              <div className="pos-menu-price-row pos-menu-price-row--sr" aria-hidden="true">
                <span>ราคาหน้าร้าน</span>
                <span>ราคาเดลิเวอรี่</span>
              </div>
            </section>

            <section className="pos-menu-editor-card pos-menu-field-block" aria-label="กลุ่มตัวเลือก">
              <div className="pos-menu-options-head">
                <h2 className="pos-menu-editor-card-title">กลุ่มตัวเลือก</h2>
                <span className="muted pos-menu-link-count">
                  ผูกแล้ว {linkedGroupIds.length} กลุ่ม
                </span>
              </div>
              {linkedGroups.length > 1 ? (
                <>
                  <p className="muted pos-menu-sort-hint">กด ↑↓ เลื่อนลำดับกลุ่ม — ไปหน้าขายทันที</p>
                  <PosSortableList
                    ids={linkedGroupIds}
                    onReorder={(ids) => {
                      setLinkedGroupIds(ids);
                      void updateMenuItem(item.id, { optionGroupIds: ids }).catch((err) =>
                        setError((err as Error).message),
                      );
                    }}
                    className="pos-menu-link-groups-sort"
                    renderItem={(gid) => {
                      const g = activeGroups.find((x) => x.id === gid);
                      return g ? <span>{g.name}</span> : null;
                    }}
                  />
                </>
              ) : null}
              <ul className="pos-menu-link-groups">
                {unlinkedGroups.map((g) => {
                  const activeChoices = (g.options || []).filter((o) => o.active !== false);
                  return (
                    <li key={g.id}>
                      <div className="pos-menu-toggle-row pos-menu-link-group-row">
                        <span className="pos-menu-link-group-meta">
                          <span className="pos-menu-link-group-name">{g.name}</span>
                          <span className="muted pos-menu-link-group-sub">
                            {activeChoices.length} ตัวเลือก
                            {g.required ? " · จำเป็น" : ""}
                            {` · ${selectionTypeLabel(g.selectionType)}`}
                            {activeChoices.length
                              ? ` · ${activeChoices
                                  .slice(0, 3)
                                  .map((o) => o.name)
                                  .join(", ")}${activeChoices.length > 3 ? "…" : ""}`
                              : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="pos-menu-link-group-toggle"
                          aria-pressed={false}
                          aria-label={`ผูกกลุ่ม ${g.name}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleGroup(g.id);
                          }}
                        >
                          ผูก
                        </button>
                      </div>
                    </li>
                  );
                })}
                {linkedGroups.map((g) => {
                  const activeChoices = (g.options || []).filter((o) => o.active !== false);
                  return (
                    <li key={g.id}>
                      <div className="pos-menu-toggle-row pos-menu-link-group-row">
                        <span className="pos-menu-link-group-meta">
                          <span className="pos-menu-link-group-name">
                            {g.name}
                            {g.required ? (
                              <span className="pos-menu-badge pos-menu-badge--req">จำเป็น</span>
                            ) : null}
                          </span>
                          <span className="muted pos-menu-link-group-sub">
                            {activeChoices.length} ตัวเลือก · {selectionTypeLabel(g.selectionType)}
                            {activeChoices.length
                              ? ` · ${activeChoices
                                  .slice(0, 4)
                                  .map((o) => o.name)
                                  .join(", ")}${activeChoices.length > 4 ? "…" : ""}`
                              : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="pos-menu-link-group-toggle is-on"
                          aria-pressed={true}
                          aria-label={`ถอดกลุ่ม ${g.name}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleGroup(g.id);
                          }}
                        >
                          ผูกแล้ว
                        </button>
                      </div>
                    </li>
                  );
                })}
                {!activeGroups.length ? (
                  <li className="muted">ยังไม่มีกลุ่มตัวเลือก — สร้างจากแท็บกลุ่มตัวเลือก</li>
                ) : null}
              </ul>
            </section>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="pos-menu-editor-footer">
          <button
            type="button"
            className="ghost-btn pos-menu-delete-btn pos-menu-btn-sm"
            onClick={() => void onDelete()}
          >
            <Trash2 size={14} aria-hidden /> เก็บเข้าคลัง
          </button>

          <p className="muted pos-menu-price-hint">
            หน้าร้าน ฿{formatPlainNumber(Number(price) || 0)}
            {deliveryPrice.trim() !== ""
              ? ` · เดลิเวอรี่ ฿${formatPlainNumber(Number(deliveryPrice) || 0)}`
              : " · เดลิเวอรี่ = หน้าร้าน"}
          </p>

          <div className="pos-menu-editor-actions">
            {modal ? (
              <button type="button" className="ghost-btn pos-menu-btn-sm" onClick={onBack}>
                ยกเลิก
              </button>
            ) : null}
            <button
              type="submit"
              className="primary-btn pos-menu-save-btn pos-menu-btn-sm"
              disabled={busy || uploading}
            >
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </div>
      </form>

      {cropSource ? (
        <PosMenuImageCropModal
          source={cropSource}
          onCancel={() => setCropSource(null)}
          onConfirm={(dataUrl) => {
            setCropSource(null);
            void applyImageUrl(dataUrl).catch((err) => setError((err as Error).message));
          }}
        />
      ) : null}
    </div>
  );
}
