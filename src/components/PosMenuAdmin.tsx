"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Pencil, Plus } from "lucide-react";
import { PosHardLink } from "@/components/PosHardLink";
import { PosMenuItemEditor } from "@/components/PosMenuItemEditor";
import { PosMenuModal } from "@/components/PosMenuModal";
import { PosOptionGroupEditor } from "@/components/PosOptionGroupEditor";
import { PosSortableList } from "@/components/PosSortableList";
import { ensurePosDeviceAuth } from "@/lib/pos-auth";
import { loadPosMenuCache } from "@/lib/pos-menu-cache";
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
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import { PosLazyMenuImage } from "@/components/PosLazyMenuImage";

type Tab = "categories" | "groups" | "promotions";
type Screen =
  | { kind: "list" }
  | { kind: "edit-item"; id: string }
  | { kind: "edit-group"; id: string };

type QuickAdd =
  | { kind: "category" }
  | { kind: "item"; categoryId: string }
  | { kind: "group" }
  | null;

function initialMenuFromCache() {
  const cached = loadPosMenuCache({ withImages: true });
  return {
    categories: cached?.categories ?? [],
    items: cached?.items ?? [],
    optionGroups: cached?.optionGroups ?? [],
  };
}

export function PosMenuAdmin({ embedded = false }: { embedded?: boolean }) {
  const seeded = initialMenuFromCache();
  const [tab, setTab] = useState<Tab>("categories");
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [quickAdd, setQuickAdd] = useState<QuickAdd>(null);
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("45");
  const [categories, setCategories] = useState<MenuCategory[]>(seeded.categories);
  const [items, setItems] = useState<MenuItem[]>(seeded.items);
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroup[]>(seeded.optionGroups);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "item"; item: MenuItem } | { kind: "group"; group: MenuOptionGroup } | null
  >(null);

  useEffect(() => {
    let alive = true;
    void ensurePosDeviceAuth()
      .then(() => {
        if (alive) setAuthReady(true);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const u1 = subscribeMenuCategories(setCategories, (e) => setError(e.message));
    const u2 = subscribeMenuItems(setItems, (e) => setError(e.message));
    const u3 = subscribeMenuOptionGroups(setOptionGroups, (e) => setError(e.message));
    return () => {
      u1();
      u2();
      u3();
    };
  }, [authReady]);

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

  function openQuickAdd(next: QuickAdd) {
    setQuickName("");
    setQuickPrice("45");
    setQuickAdd(next);
  }

  async function submitQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickAdd || !quickName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (quickAdd.kind === "category") {
        await addMenuCategory(quickName.trim());
      } else if (quickAdd.kind === "group") {
        const id = await addMenuOptionGroup(quickName.trim());
        setTab("groups");
        setScreen({ kind: "edit-group", id });
      } else {
        const price = Number(quickPrice) || 0;
        const id = await addMenuItem({
          categoryId: quickAdd.categoryId,
          name: quickName.trim(),
          price,
        });
        setExpandedCat(quickAdd.categoryId);
        setScreen({ kind: "edit-item", id });
      }
      setQuickAdd(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const quickAddTitle =
    quickAdd?.kind === "category"
      ? "เพิ่มหมวด"
      : quickAdd?.kind === "group"
        ? "เพิ่มกลุ่มตัวเลือก"
        : "เพิ่มเมนู";

  return (
    <div className={`pos-menu-admin ${embedded ? "pos-menu-admin--embedded" : ""}`}>
      {!embedded ? (
        <header className="pos-menu-admin-top">
          <PosHardLink href="/pos/sell/" className="ghost-btn pos-menu-back">
            <ArrowLeft size={16} aria-hidden />
            ขาย
          </PosHardLink>
          <h1>เมนู</h1>
          <button
            type="button"
            className="pos-menu-inline-btn"
            disabled={busy || !authReady}
            onClick={() => openQuickAdd(tab === "groups" ? { kind: "group" } : { kind: "category" })}
            title="เพิ่ม"
          >
            <Plus size={16} />
          </button>
        </header>
      ) : null}

      <div className="pos-menu-shell">
        {embedded ? (
          <nav className="pos-menu-subnav" aria-label="เมนูย่อย">
            <button
              type="button"
              className={tab === "categories" ? "is-active" : ""}
              onClick={() => setTab("categories")}
            >
              เมนูอาหาร
            </button>
            <button
              type="button"
              className={tab === "groups" ? "is-active" : ""}
              onClick={() => setTab("groups")}
            >
              กลุ่มตัวเลือก
            </button>
            <button type="button" className={tab === "promotions" ? "is-active" : ""} onClick={() => setTab("promotions")}>
              โปรโมชั่น
            </button>
          </nav>
        ) : null}

        <div className="pos-menu-shell-main">
          {embedded ? (
            <header className="pos-menu-admin-head pos-menu-admin-head--compact">
              <h1>{tab === "groups" ? "กลุ่มตัวเลือก" : tab === "promotions" ? "โปรโมชั่น" : "เมนูอาหาร"}</h1>
              <button
                type="button"
                className="pos-menu-inline-btn pos-menu-inline-btn--primary"
                disabled={busy || !authReady || tab === "promotions"}
                onClick={() =>
                  openQuickAdd(tab === "groups" ? { kind: "group" } : { kind: "category" })
                }
              >
                <Plus size={14} aria-hidden />
                {tab === "groups" ? "กลุ่ม" : "หมวด"}
              </button>
            </header>
          ) : (
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
          )}

          {error ? <p className="error-text pos-menu-admin-error">{error}</p> : null}
          {!authReady && !error && !items.length ? (
            <p className="muted pos-menu-loading">กำลังเชื่อมต่อเมนู...</p>
          ) : null}
          {!authReady && items.length ? (
            <p className="muted pos-menu-loading">แสดงจากแคช — กำลังเชื่อมเพื่อแก้ไข</p>
          ) : null}

          {authReady && tab === "promotions" ? (
            <div className="pos-module-empty muted">
              <p>โปรโมชั่นหน้าร้าน — กำลังพัฒนา</p>
            </div>
          ) : null}

          {authReady && tab === "categories" ? (
            <>
              <p className="muted pos-menu-sort-hint">
                กด ↑↓ หรือลาก ≡ — ลำดับหมวดนี้ไปแท็บขายหลักทันที
              </p>
              {categories.length ? (
                <PosSortableList
                  ids={categoryIds}
                  onReorder={(ids) => {
                    setCategories((prev) => {
                      const map = new Map(prev.map((c) => [c.id, c]));
                      return ids
                        .map((id, i) => {
                          const row = map.get(id);
                          return row ? { ...row, sortOrder: (i + 1) * 1000 } : null;
                        })
                        .filter((c): c is NonNullable<typeof c> => !!c);
                    });
                    void reorderMenuCategories(ids).catch((e) => setError((e as Error).message));
                  }}
                  className="pos-menu-cat-list"
                  renderItem={(catId) => {
                    const cat = categories.find((c) => c.id === catId);
                    if (!cat) return null;
                    const catItems = (itemsByCat.get(catId) || [])
                      .slice()
                      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"));
                    const open = expandedCat === catId;
                    return (
                      <div className="pos-menu-cat-row-inner">
                        <div className="pos-menu-cat-head-row">
                          <button
                            type="button"
                            className="pos-menu-cat-head"
                            onClick={() => setExpandedCat(open ? null : catId)}
                          >
                            <span>
                              {cat.name} <span className="muted">({catItems.length})</span>
                            </span>
                            <ChevronDown
                              size={16}
                              className={open ? "pos-menu-chevron-open" : ""}
                              aria-hidden
                            />
                          </button>
                          <button
                            type="button"
                            className="pos-menu-inline-btn"
                            onClick={() => openQuickAdd({ kind: "item", categoryId: catId })}
                          >
                            <Plus size={14} aria-hidden /> เมนู
                          </button>
                        </div>
                        {open ? (
                          catItems.length ? (
                            <PosSortableList
                              ids={catItems.map((i) => i.id)}
                              onReorder={(ids) => {
                                setItems((prev) => {
                                  const others = prev.filter((i) => i.categoryId !== catId);
                                  const inCat = new Map(
                                    prev.filter((i) => i.categoryId === catId).map((i) => [i.id, i]),
                                  );
                                  const reordered = ids
                                    .map((id, i) => {
                                      const row = inCat.get(id);
                                      return row
                                        ? { ...row, sortOrder: (i + 1) * 1000, categoryId: catId }
                                        : null;
                                    })
                                    .filter((i): i is NonNullable<typeof i> => !!i);
                                  return [...others, ...reordered];
                                });
                                void reorderMenuItemsInCategory(catId, ids).catch((e) =>
                                  setError((e as Error).message),
                                );
                              }}
                              className="pos-menu-item-list"
                              renderItem={(itemId) => {
                                const item = catItems.find((i) => i.id === itemId);
                                if (!item) return null;
                                return (
                                  <div className="pos-menu-item-row">
                                    <PosLazyMenuImage
                                      url={item.imageUrl}
                                      className="pos-menu-item-thumb"
                                      placeholderClassName="pos-menu-item-thumb-ph"
                                      placeholder=""
                                    />
                                    <button
                                      type="button"
                                      className="pos-menu-item-main"
                                      onClick={() => setScreen({ kind: "edit-item", id: item.id })}
                                    >
                                      <span className="pos-menu-item-text">
                                        {item.recommended ? "★ " : ""}
                                        {item.name}
                                        {!item.active ? " (หมด)" : ""}
                                      </span>
                                      <span className="muted">฿{formatPlainNumber(item.price)}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="pos-menu-inline-btn"
                                      aria-label="แก้ไข"
                                      onClick={() => setScreen({ kind: "edit-item", id: item.id })}
                                    >
                                      <Pencil size={12} />
                                    </button>
                                  </div>
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
          ) : authReady && tab === "groups" ? (
            <>
              <p className="muted pos-menu-sort-hint">กด ↑↓ หรือลาก ≡ เพื่อเรียงลำดับ — ใช้บนแท็บเล็ตได้</p>
              {optionGroups.length ? (
                <PosSortableList
                  ids={groupIds}
                  onReorder={(ids) => {
                    setOptionGroups((prev) => {
                      const map = new Map(prev.map((g) => [g.id, g]));
                      return ids
                        .map((id, i) => {
                          const row = map.get(id);
                          return row ? { ...row, sortOrder: (i + 1) * 1000 } : null;
                        })
                        .filter((g): g is NonNullable<typeof g> => !!g);
                    });
                    void reorderMenuOptionGroups(ids).catch((e) => setError((e as Error).message));
                  }}
                  className="pos-menu-group-list"
                  renderItem={(groupId) => {
                    const group = optionGroups.find((g) => g.id === groupId);
                    if (!group) return null;
                    return (
                      <div className="pos-menu-group-row">
                        <button
                          type="button"
                          className="pos-menu-group-main"
                          onClick={() => setScreen({ kind: "edit-group", id: group.id })}
                        >
                          <span>{group.name}</span>
                          <span className="muted">{group.options.length} ตัวเลือก</span>
                        </button>
                        <button
                          type="button"
                          className="pos-menu-inline-btn"
                          aria-label="แก้ไข"
                          onClick={() => setScreen({ kind: "edit-group", id: group.id })}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    );
                  }}
                />
              ) : (
                <p className="muted pos-menu-empty">เพิ่มกลุ่มตัวเลือกด้วยปุ่ม +</p>
              )}
            </>
          ) : null}
        </div>
      </div>

      {quickAdd ? (
        <PosMenuModal title={quickAddTitle} onClose={() => setQuickAdd(null)}>
          <form className="pos-menu-quick-form" onSubmit={(e) => void submitQuickAdd(e)}>
            <label>
              <span>ชื่อ</span>
              <input value={quickName} onChange={(e) => setQuickName(e.target.value)} required autoFocus />
            </label>
            {quickAdd.kind === "item" ? (
              <label>
                <span>ราคา (฿)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={quickPrice}
                  onChange={(e) => setQuickPrice(e.target.value)}
                  required
                />
              </label>
            ) : null}
            <div className="pos-menu-editor-actions">
              <button type="button" className="ghost-btn pos-menu-btn-sm" onClick={() => setQuickAdd(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="primary-btn pos-menu-btn-sm" disabled={busy}>
                {busy ? "กำลังเพิ่ม..." : "เพิ่ม"}
              </button>
            </div>
          </form>
        </PosMenuModal>
      ) : null}

      {editItem ? (
        <PosMenuModal title="แก้ไขเมนู" onClose={() => setScreen({ kind: "list" })} wide>
          <PosMenuItemEditor
            modal
            item={editItem}
            categories={categories}
            optionGroups={optionGroups}
            onBack={() => setScreen({ kind: "list" })}
            onSaved={() => setScreen({ kind: "list" })}
            onDelete={() => setDeleteTarget({ kind: "item", item: editItem })}
          />
        </PosMenuModal>
      ) : null}

      {editGroup ? (
        <PosMenuModal title="แก้ไขกลุ่มตัวเลือก" onClose={() => setScreen({ kind: "list" })} wide>
          <PosOptionGroupEditor
            modal
            group={editGroup}
            onBack={() => setScreen({ kind: "list" })}
            onSaved={() => setScreen({ kind: "list" })}
            onDelete={() => setDeleteTarget({ kind: "group", group: editGroup })}
          />
        </PosMenuModal>
      ) : null}

      <PosConfirmDialog
        open={deleteTarget !== null}
        title={
          deleteTarget?.kind === "item"
            ? `ลบเมนู "${deleteTarget.item.name}"?`
            : deleteTarget?.kind === "group"
              ? `ลบกลุ่ม "${deleteTarget.group.name}"?`
              : ""
        }
        message="รายการที่ลบแล้วกู้คืนไม่ได้"
        confirmLabel="ลบ"
        destructive
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void (async () => {
            setBusy(true);
            try {
              if (deleteTarget.kind === "item") {
                await deleteMenuItem(deleteTarget.item.id);
              } else {
                await deleteMenuOptionGroup(deleteTarget.group.id);
              }
              setDeleteTarget(null);
              setScreen({ kind: "list" });
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
    </div>
  );
}
