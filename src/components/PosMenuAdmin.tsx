"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Pencil, Plus } from "lucide-react";
import { PosMenuItemEditor } from "@/components/PosMenuItemEditor";
import { PosOptionGroupEditor } from "@/components/PosOptionGroupEditor";
import { PosSortableList } from "@/components/PosSortableList";
import {
  addMenuCategory,
  addMenuItem,
  deleteMenuItem,
  reorderMenuCategories,
  reorderMenuItemsInCategory,
  subscribeMenuCategories,
  subscribeMenuItems,
} from "@/lib/pos-menu";
import {
  addMenuOptionGroup,
  deleteMenuOptionGroup,
  reorderMenuOptionGroups,
  subscribeMenuOptionGroups,
} from "@/lib/pos-menu-options";
import type { MenuCategory, MenuItem, MenuOptionGroup } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

type Tab = "categories" | "groups";
type Screen =
  | { kind: "list" }
  | { kind: "edit-item"; id: string }
  | { kind: "edit-group"; id: string };

export function PosMenuAdmin() {
  const [tab, setTab] = useState<Tab>("categories");
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroup[]>([]);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u1 = subscribeMenuCategories(setCategories, (e) => setError(e.message));
    const u2 = subscribeMenuItems(setItems, (e) => setError(e.message));
    const u3 = subscribeMenuOptionGroups(setOptionGroups, (e) => setError(e.message));
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const itemsByCat = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.categoryId) || [];
      list.push(item);
      map.set(item.categoryId, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [items]);

  const categoryIds = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.id),
    [categories],
  );
  const groupIds = useMemo(
    () => [...optionGroups].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => g.id),
    [optionGroups],
  );

  const editItem = screen.kind === "edit-item" ? items.find((i) => i.id === screen.id) : null;
  const editGroup =
    screen.kind === "edit-group" ? optionGroups.find((g) => g.id === screen.id) : null;

  if (editItem) {
    return (
      <PosMenuItemEditor
        item={editItem}
        categories={categories}
        optionGroups={optionGroups}
        onBack={() => setScreen({ kind: "list" })}
        onSaved={() => setScreen({ kind: "list" })}
        onDelete={async () => {
          if (!confirm(`ลบเมนู "${editItem.name}"?`)) return;
          await deleteMenuItem(editItem.id);
          setScreen({ kind: "list" });
        }}
      />
    );
  }

  if (editGroup) {
    return (
      <PosOptionGroupEditor
        group={editGroup}
        onBack={() => setScreen({ kind: "list" })}
        onSaved={() => setScreen({ kind: "list" })}
        onDelete={async () => {
          if (!confirm(`ลบกลุ่ม "${editGroup.name}"?`)) return;
          await deleteMenuOptionGroup(editGroup.id);
          setScreen({ kind: "list" });
        }}
      />
    );
  }

  async function handleAddCategory() {
    const name = window.prompt("ชื่อหมวดใหม่");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      await addMenuCategory(name.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddItem(categoryId: string) {
    const name = window.prompt("ชื่อเมนูใหม่");
    if (!name?.trim()) return;
    const priceStr = window.prompt("ราคาหน้าร้าน (บาท)", "45");
    const price = Number(priceStr) || 0;
    setBusy(true);
    try {
      const id = await addMenuItem({ categoryId, name: name.trim(), price });
      setScreen({ kind: "edit-item", id });
      setExpandedCat(categoryId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddGroup() {
    const name = window.prompt("ชื่อกลุ่มตัวเลือก");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const id = await addMenuOptionGroup(name.trim());
      setTab("groups");
      setScreen({ kind: "edit-group", id });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-menu-admin">
      <header className="pos-menu-admin-top">
        <Link href="/pos/" className="ghost-btn pos-menu-back">
          <ArrowLeft size={18} aria-hidden />
          ขาย
        </Link>
        <h1>เมนู</h1>
        <button
          type="button"
          className="ghost-btn"
          disabled={busy}
          onClick={() => void (tab === "categories" ? handleAddCategory() : handleAddGroup())}
          title="เพิ่ม"
        >
          <Plus size={20} />
        </button>
      </header>

      <div className="pos-menu-tabs">
        <button
          type="button"
          className={tab === "categories" ? "is-active" : ""}
          onClick={() => setTab("categories")}
        >
          หมวดหมู่รายการ
        </button>
        <button
          type="button"
          className={tab === "groups" ? "is-active" : ""}
          onClick={() => setTab("groups")}
        >
          กลุ่มตัวเลือก
        </button>
      </div>

      {error ? <p className="error-text pos-menu-admin-error">{error}</p> : null}

      {tab === "categories" ? (
        <>
          <p className="muted pos-menu-sort-hint">ลาก ≡ เพื่อเรียงลำดับหมวดและเมนู</p>
          {categories.length ? (
            <PosSortableList
              ids={categoryIds}
              onReorder={(ids) => void reorderMenuCategories(ids)}
              className="pos-menu-cat-list"
              renderItem={(catId) => {
                const cat = categories.find((c) => c.id === catId);
                if (!cat) return null;
                const catItems = itemsByCat.get(catId) || [];
                const open = expandedCat === catId;
                return (
                  <div className="pos-menu-cat-row-inner">
                    <button
                      type="button"
                      className="pos-menu-cat-head"
                      onClick={() => setExpandedCat(open ? null : catId)}
                    >
                      <span>
                        {cat.name} ({catItems.length})
                      </span>
                      <ChevronDown
                        size={18}
                        className={open ? "pos-menu-chevron-open" : ""}
                        aria-hidden
                      />
                    </button>
                    <div className="pos-menu-cat-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => void handleAddItem(catId)}
                      >
                        <Plus size={16} /> เมนู
                      </button>
                    </div>
                    {open ? (
                      catItems.length ? (
                        <PosSortableList
                          ids={catItems.map((i) => i.id)}
                          onReorder={(ids) => void reorderMenuItemsInCategory(catId, ids)}
                          className="pos-menu-item-list"
                          renderItem={(itemId) => {
                            const item = catItems.find((i) => i.id === itemId);
                            if (!item) return null;
                            return (
                              <button
                                type="button"
                                className="pos-menu-item-row"
                                onClick={() => setScreen({ kind: "edit-item", id: item.id })}
                              >
                                {item.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={item.imageUrl} alt="" className="pos-menu-item-thumb" />
                                ) : null}
                                <span className="pos-menu-item-text">
                                  {item.recommended ? "★ " : ""}
                                  {item.name}
                                  {!item.active ? " (หมด)" : ""}
                                </span>
                                <span className="muted">฿{formatPlainNumber(item.price)}</span>
                                <Pencil size={14} aria-hidden />
                              </button>
                            );
                          }}
                        />
                      ) : (
                        <p className="muted pos-menu-empty">ยังไม่มีเมนูในหมวดนี้</p>
                      )
                    ) : null}
                  </div>
                );
              }}
            />
          ) : (
            <p className="muted pos-menu-empty">เพิ่มหมวดแรกด้วยปุ่ม +</p>
          )}
        </>
      ) : (
        <>
          <p className="muted pos-menu-sort-hint">ลาก ≡ เพื่อเรียงลำดับกลุ่ม</p>
          {optionGroups.length ? (
            <PosSortableList
              ids={groupIds}
              onReorder={(ids) => void reorderMenuOptionGroups(ids)}
              className="pos-menu-group-list"
              renderItem={(groupId) => {
                const group = optionGroups.find((g) => g.id === groupId);
                if (!group) return null;
                return (
                  <button
                    type="button"
                    className="pos-menu-group-row"
                    onClick={() => setScreen({ kind: "edit-group", id: group.id })}
                  >
                    <span>{group.name}</span>
                    <span className="muted">{group.options.length} ตัวเลือก</span>
                    <Pencil size={14} aria-hidden />
                  </button>
                );
              }}
            />
          ) : (
            <p className="muted pos-menu-empty">เพิ่มกลุ่มตัวเลือกด้วยปุ่ม +</p>
          )}
        </>
      )}
    </div>
  );
}
