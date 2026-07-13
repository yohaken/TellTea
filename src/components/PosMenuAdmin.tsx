"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus } from "lucide-react";
import { PosMenuItemEditor } from "@/components/PosMenuItemEditor";
import { PosOptionGroupEditor } from "@/components/PosOptionGroupEditor";
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
    const priceStr = window.prompt("ราคา (บาท)", "45");
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

  async function moveCategory(id: string, dir: -1 | 1) {
    const ids = categories.map((c) => c.id);
    const idx = ids.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    [ids[idx], ids[next]] = [ids[next]!, ids[idx]!];
    await reorderMenuCategories(ids);
  }

  async function moveItem(categoryId: string, itemId: string, dir: -1 | 1) {
    const list = itemsByCat.get(categoryId) || [];
    const ids = list.map((i) => i.id);
    const idx = ids.indexOf(itemId);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    [ids[idx], ids[next]] = [ids[next]!, ids[idx]!];
    await reorderMenuItemsInCategory(categoryId, ids);
  }

  async function moveGroup(id: string, dir: -1 | 1) {
    const ids = optionGroups.map((g) => g.id);
    const idx = ids.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    [ids[idx], ids[next]] = [ids[next]!, ids[idx]!];
    await reorderMenuOptionGroups(ids);
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
        <ul className="pos-menu-cat-list">
          {categories.map((cat, catIdx) => {
            const catItems = itemsByCat.get(cat.id) || [];
            const open = expandedCat === cat.id;
            return (
              <li key={cat.id} className="pos-menu-cat-row">
                <button
                  type="button"
                  className="pos-menu-cat-head"
                  onClick={() => setExpandedCat(open ? null : cat.id)}
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
                    disabled={catIdx === 0}
                    onClick={() => void moveCategory(cat.id, -1)}
                    aria-label="เลื่อนขึ้น"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={catIdx === categories.length - 1}
                    onClick={() => void moveCategory(cat.id, 1)}
                    aria-label="เลื่อนลง"
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void handleAddItem(cat.id)}
                  >
                    <Plus size={16} /> เมนู
                  </button>
                </div>
                {open ? (
                  <ul className="pos-menu-item-list">
                    {catItems.map((item, itemIdx) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="pos-menu-item-row"
                          onClick={() => setScreen({ kind: "edit-item", id: item.id })}
                        >
                          <span>
                            {item.recommended ? "★ " : ""}
                            {item.name}
                            {!item.active ? " (หมด)" : ""}
                          </span>
                          <span className="muted">฿{formatPlainNumber(item.price)}</span>
                          <Pencil size={14} aria-hidden />
                        </button>
                        <div className="pos-menu-item-sort">
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={itemIdx === 0}
                            onClick={() => void moveItem(cat.id, item.id, -1)}
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={itemIdx === catItems.length - 1}
                            onClick={() => void moveItem(cat.id, item.id, 1)}
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                    {!catItems.length ? (
                      <li className="muted pos-menu-empty">ยังไม่มีเมนูในหมวดนี้</li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {!categories.length ? <li className="muted pos-menu-empty">เพิ่มหมวดแรกด้วยปุ่ม +</li> : null}
        </ul>
      ) : (
        <ul className="pos-menu-group-list">
          {optionGroups.map((group, idx) => (
            <li key={group.id}>
              <button
                type="button"
                className="pos-menu-group-row"
                onClick={() => setScreen({ kind: "edit-group", id: group.id })}
              >
                <span>{group.name}</span>
                <span className="muted">{group.options.length} ตัวเลือก</span>
                <Pencil size={14} aria-hidden />
              </button>
              <div className="pos-menu-item-sort">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={idx === 0}
                  onClick={() => void moveGroup(group.id, -1)}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={idx === optionGroups.length - 1}
                  onClick={() => void moveGroup(group.id, 1)}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </li>
          ))}
          {!optionGroups.length ? (
            <li className="muted pos-menu-empty">เพิ่มกลุ่มตัวเลือกด้วยปุ่ม +</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
