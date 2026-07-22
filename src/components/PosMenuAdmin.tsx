"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Copy, Link2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { PosHardLink } from "@/components/PosHardLink";
import { PosMenuItemEditor } from "@/components/PosMenuItemEditor";
import { PosMenuModal } from "@/components/PosMenuModal";
import { PosMenuOptionPriceTable } from "@/components/PosMenuOptionPriceTable";
import { PosOptionGroupEditor } from "@/components/PosOptionGroupEditor";
import { PosSortableList } from "@/components/PosSortableList";
import { ensurePosDeviceAuth } from "@/lib/pos-auth";
import { setMenuDbMode, type MenuDbMode } from "@/lib/pos-menu-db";
import { loadPosMenuCache } from "@/lib/pos-menu-cache";
import { publishLocalMenuOrder } from "@/lib/pos-menu-preload";
import { applyFixedCategorySortOrder } from "@/lib/pos-fixed-category-order";
import {
  addMenuCategory,
  addMenuItem,
  archiveMenuCategory,
  archiveMenuItem,
  deleteMenuItem,
  duplicateMenuItem,
  reorderMenuCategories,
  reorderMenuItemsInCategory,
  restoreMenuCategory,
  restoreMenuItem,
  subscribeMenuCategories,
  subscribeMenuItems,
  updateMenuCategory,
  updateMenuItem,
} from "@/lib/pos-menu";
import {
  addMenuOptionGroup,
  archiveMenuOptionGroup,
  deleteMenuOptionGroup,
  duplicateMenuOptionGroup,
  reorderMenuOptionGroups,
  restoreMenuOptionGroup,
  subscribeMenuOptionGroups,
} from "@/lib/pos-menu-options";
import type { MenuCategory, MenuItem, MenuOptionGroup } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import { PosLazyMenuImage } from "@/components/PosLazyMenuImage";

const BOH_MENU_URL = "https://telltea-shop.web.app/menu/";

type VisibilityFilter = "active" | "archived" | "all";
type DeleteTarget =
  | { kind: "item"; item: MenuItem; mode: "archive" | "hard" }
  | { kind: "group"; group: MenuOptionGroup; mode: "archive" | "hard" }
  | { kind: "category"; category: MenuCategory; mode: "archive" };

type Tab = "categories" | "groups" | "prices" | "promotions";
type Screen =
  | { kind: "list" }
  | { kind: "edit-item"; id: string }
  | { kind: "edit-group"; id: string };

type QuickAdd =
  | { kind: "category" }
  | { kind: "item"; categoryId: string }
  | { kind: "group" }
  | null;

function isItemArchived(item: MenuItem): boolean {
  return item.active === false && item.visibleOnPos === false;
}

function isGroupArchived(group: MenuOptionGroup): boolean {
  return group.active === false;
}

function isCategoryArchived(cat: MenuCategory): boolean {
  return cat.active === false;
}

function countMenusUsingGroup(items: MenuItem[], groupId: string): number {
  return items.filter((i) => i.optionGroupIds?.includes(groupId)).length;
}

function initialMenuFromCache() {
  const cached = loadPosMenuCache({ withImages: true });
  return {
    categories: applyFixedCategorySortOrder(cached?.categories ?? []),
    items: cached?.items ?? [],
    optionGroups: cached?.optionGroups ?? [],
  };
}

export function PosMenuAdmin({
  embedded = false,
  authMode = "pos",
}: {
  embedded?: boolean;
  /** owner = หลังร้าน (Google) · pos = แท็บเล็ต (device auth) */
  authMode?: MenuDbMode;
}) {
  const isBoh = authMode === "owner";
  const seeded = isBoh
    ? { categories: [] as MenuCategory[], items: [] as MenuItem[], optionGroups: [] as MenuOptionGroup[] }
    : initialMenuFromCache();
  const [tab, setTab] = useState<Tab>("categories");
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [quickAdd, setQuickAdd] = useState<QuickAdd>(null);
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("45");
  const [quickDeliveryPrice, setQuickDeliveryPrice] = useState("");
  const [categories, setCategories] = useState<MenuCategory[]>(seeded.categories);
  const [items, setItems] = useState<MenuItem[]>(seeded.items);
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroup[]>(seeded.optionGroups);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("active");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renameCategory, setRenameCategory] = useState<MenuCategory | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [linkGroupId, setLinkGroupId] = useState<string | null>(null);
  const [linkSelected, setLinkSelected] = useState<Set<string>>(new Set());
  const [linkSearch, setLinkSearch] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  /** เมนูที่เพิ่งสร้าง — เปิด editor ทันทีแม้ snapshot ยังไม่มา */
  const [freshItemId, setFreshItemId] = useState<string | null>(null);

  useEffect(() => {
    setMenuDbMode(authMode);
    let alive = true;
    if (authMode === "owner") {
      setAuthReady(true);
      return () => {
        alive = false;
        setMenuDbMode("pos");
      };
    }
    void ensurePosDeviceAuth()
      .then(() => {
        if (alive) setAuthReady(true);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
      setMenuDbMode("pos");
    };
  }, [authMode]);

  useEffect(() => {
    if (!authReady) return;
    const u1 = subscribeMenuCategories(
      (list) => setCategories(applyFixedCategorySortOrder(list)),
      (e) => setError(e.message),
    );
    const u2 = subscribeMenuItems(setItems, (e) => setError(e.message));
    const u3 = subscribeMenuOptionGroups(setOptionGroups, (e) => setError(e.message));
    return () => {
      u1();
      u2();
      u3();
    };
  }, [authReady]);

  const itemsByCat = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const archived = isItemArchived(item);
      if (visibilityFilter === "active" && archived) continue;
      if (visibilityFilter === "archived" && !archived) continue;
      if (filterCategoryId && item.categoryId !== filterCategoryId) continue;
      if (
        q &&
        !item.name.toLowerCase().includes(q) &&
        !(item.nameEn || "").toLowerCase().includes(q) &&
        !(item.code || "").toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = map.get(item.categoryId) || [];
      list.push(item);
      map.set(item.categoryId, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [items, searchQuery, filterCategoryId, visibilityFilter]);

  const visibleCategoryIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    let filtered = filterCategoryId ? base.filter((c) => c.id === filterCategoryId) : base;
    filtered = filtered.filter((c) => {
      const archived = isCategoryArchived(c);
      if (visibilityFilter === "active" && archived) return false;
      if (visibilityFilter === "archived" && !archived) return false;
      return true;
    });
    if (q) {
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(q) || (itemsByCat.get(c.id) || []).length > 0,
      );
    }
    return filtered.map((c) => c.id);
  }, [categories, filterCategoryId, searchQuery, visibilityFilter, itemsByCat]);

  const totalItemsInCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (isItemArchived(item)) continue;
      map.set(item.categoryId, (map.get(item.categoryId) || 0) + 1);
    }
    return map;
  }, [items]);

  const visibleGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...optionGroups]
      .filter((g) => {
        const archived = isGroupArchived(g);
        if (visibilityFilter === "active" && archived) return false;
        if (visibilityFilter === "archived" && !archived) return false;
        if (q) {
          const inName = g.name.toLowerCase().includes(q);
          const inChoice = g.options.some((o) => o.name.toLowerCase().includes(q));
          if (!inName && !inChoice) return false;
        }
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [optionGroups, searchQuery, visibilityFilter]);

  const categoryIds = useMemo(
    () => visibleCategoryIds,
    [visibleCategoryIds],
  );
  const groupIds = useMemo(() => visibleGroups.map((g) => g.id), [visibleGroups]);

  const linkGroup = linkGroupId
    ? optionGroups.find((g) => g.id === linkGroupId) || null
    : null;

  const linkCandidates = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    return items
      .filter((i) => !isItemArchived(i))
      .filter((i) => {
        if (!q) return true;
        return (
          i.name.toLowerCase().includes(q) ||
          (i.code || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [items, linkSearch]);

  function openLinkMenus(groupId: string) {
    const selected = new Set<string>();
    for (const item of items) {
      if (item.optionGroupIds?.includes(groupId)) selected.add(item.id);
    }
    setLinkSelected(selected);
    setLinkSearch("");
    setLinkGroupId(groupId);
  }

  async function saveLinkMenus() {
    if (!linkGroupId) return;
    setLinkBusy(true);
    setError(null);
    try {
      const gid = linkGroupId;
      const tasks: Promise<void>[] = [];
      for (const item of items) {
        const has = item.optionGroupIds?.includes(gid) === true;
        const want = linkSelected.has(item.id);
        if (has === want) continue;
        const next = new Set(item.optionGroupIds || []);
        if (want) next.add(gid);
        else next.delete(gid);
        tasks.push(updateMenuItem(item.id, { optionGroupIds: [...next] }));
      }
      await Promise.all(tasks);
      setLinkGroupId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLinkBusy(false);
    }
  }

  const editItem = screen.kind === "edit-item" ? items.find((i) => i.id === screen.id) : null;
  const editGroup =
    screen.kind === "edit-group" ? optionGroups.find((g) => g.id === screen.id) : null;
  const editingFreshItem = Boolean(editItem && freshItemId && editItem.id === freshItemId);

  function openQuickAdd(next: QuickAdd) {
    setQuickName("");
    setQuickPrice("45");
    setQuickDeliveryPrice("");
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
        const deliveryRaw = quickDeliveryPrice.trim();
        const deliveryPrice =
          deliveryRaw !== "" ? Math.max(0, Number(deliveryRaw) || 0) : undefined;
        const id = await addMenuItem({
          categoryId: quickAdd.categoryId,
          name: quickName.trim(),
          price,
          ...(typeof deliveryPrice === "number" ? { deliveryPrice } : {}),
        });
        const now = Date.now();
        const optimistic: MenuItem = {
          id,
          categoryId: quickAdd.categoryId,
          name: quickName.trim(),
          price,
          ...(typeof deliveryPrice === "number" ? { deliveryPrice } : {}),
          sortOrder: now,
          active: true,
          visibleOnPos: true,
          recommended: false,
          createdAt: now,
          updatedAt: now,
        };
        setItems((prev) => (prev.some((i) => i.id === id) ? prev : [...prev, optimistic]));
        setFreshItemId(id);
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
    <div
      className={`pos-menu-admin ${embedded ? "pos-menu-admin--embedded" : ""}${isBoh ? " pos-menu-admin--boh" : ""}`}
    >
      {!isBoh ? (
        <p className="pos-menu-boh-banner muted" role="status">
          แนะนำจัดการเมนูที่หลังร้าน —{" "}
          <a href={BOH_MENU_URL} target="_blank" rel="noopener noreferrer">
            อื่นๆ → เมนู
          </a>
        </p>
      ) : null}
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
            <button
              type="button"
              className={tab === "prices" ? "is-active" : ""}
              onClick={() => setTab("prices")}
            >
              ตั้งราคา
            </button>
            <button type="button" className={tab === "promotions" ? "is-active" : ""} onClick={() => setTab("promotions")}>
              โปรโมชั่น
            </button>
          </nav>
        ) : null}

        <div className="pos-menu-shell-main">
          {embedded ? (
            <header className="pos-menu-admin-head pos-menu-admin-head--compact">
              <h1>
                {tab === "groups"
                  ? "กลุ่มตัวเลือก"
                  : tab === "prices"
                    ? "ตั้งราคาตัวเลือก"
                    : tab === "promotions"
                      ? "โปรโมชั่น"
                      : "เมนูอาหาร"}
              </h1>
              {tab === "categories" || tab === "groups" ? (
                <button
                  type="button"
                  className="pos-menu-inline-btn pos-menu-inline-btn--primary"
                  disabled={busy || !authReady}
                  onClick={() =>
                    openQuickAdd(tab === "groups" ? { kind: "group" } : { kind: "category" })
                  }
                >
                  <Plus size={14} aria-hidden />
                  {tab === "groups" ? "กลุ่ม" : "หมวด"}
                </button>
              ) : null}
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
              <button
                type="button"
                className={tab === "prices" ? "is-active" : ""}
                onClick={() => setTab("prices")}
              >
                ตั้งราคา
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

          {authReady && tab !== "promotions" && tab !== "prices" ? (
            <div className="pos-menu-toolbar">
              <input
                type="search"
                className="pos-menu-search"
                placeholder={
                  tab === "groups"
                    ? "ค้นหากลุ่มหรือตัวเลือก..."
                    : "ค้นหาเมนูหรือหมวด..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="ค้นหา"
              />
              {tab === "categories" ? (
                <select
                  className="pos-menu-filter-cat"
                  value={filterCategoryId}
                  onChange={(e) => setFilterCategoryId(e.target.value)}
                  aria-label="กรองหมวด"
                >
                  <option value="">ทุกหมวด</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {isCategoryArchived(c) ? " (เก็บแล้ว)" : ""}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="pos-menu-vis-filter" role="group" aria-label="สถานะ">
                {(
                  [
                    ["active", "ใช้งาน"],
                    ["archived", "เก็บแล้ว"],
                    ["all", "ทั้งหมด"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={visibilityFilter === id ? "is-active" : ""}
                    onClick={() => setVisibilityFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {authReady && tab === "prices" ? (
            <PosMenuOptionPriceTable optionGroups={optionGroups} />
          ) : null}

          {authReady && tab === "promotions" ? (
            <div className="pos-module-empty muted">
              <p>โปรโมชั่นหน้าร้าน — กำลังพัฒนา</p>
            </div>
          ) : null}

          {authReady && tab === "categories" ? (
            <>
              <p className="muted pos-menu-sort-hint">
                ลำดับหมวดตอนนี้ถูกล็อกตามที่กำหนด (น้ำเปล่าท้ายสุด) · ซิงก์ขึ้น Firebase อัตโนมัติ
              </p>
              {categories.length ? (
                <PosSortableList
                  ids={categoryIds}
                  onReorder={(ids) => {
                    const map = new Map(categories.map((c) => [c.id, c]));
                    const nextCategories = ids
                      .map((id, i) => {
                        const row = map.get(id);
                        return row ? { ...row, sortOrder: (i + 1) * 1000 } : null;
                      })
                      .filter((c): c is NonNullable<typeof c> => !!c);
                    setCategories(nextCategories);
                    publishLocalMenuOrder({
                      categories: nextCategories,
                      items,
                      optionGroups,
                    });
                    void reorderMenuCategories(ids).catch(() => {
                      /* คงลำดับในเครื่อง — จะซิงก์รอบถัดไป */
                    });
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
                              {cat.name}
                              {isCategoryArchived(cat) ? " (เก็บแล้ว)" : ""}{" "}
                              <span className="muted">
                                ({catItems.length}
                                {typeof totalItemsInCat.get(catId) === "number"
                                  ? ` · ทั้งหมวด ${totalItemsInCat.get(catId)}`
                                  : ""}
                                )
                              </span>
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
                            title="เพิ่มเมนู"
                          >
                            <Plus size={14} aria-hidden /> เมนู
                          </button>
                          <button
                            type="button"
                            className="pos-menu-inline-btn"
                            aria-label="แก้ชื่อหมวด"
                            onClick={() => {
                              setRenameCategory(cat);
                              setRenameValue(cat.name);
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                          {isCategoryArchived(cat) ? (
                            <button
                              type="button"
                              className="pos-menu-inline-btn"
                              aria-label="กู้คืนหมวด"
                              disabled={busy}
                              onClick={() => {
                                void restoreMenuCategory(cat.id).catch((err) =>
                                  setError((err as Error).message),
                                );
                              }}
                            >
                              <RotateCcw size={12} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="pos-menu-inline-btn"
                              aria-label="เก็บหมวด"
                              disabled={busy}
                              onClick={() =>
                                setDeleteTarget({ kind: "category", category: cat, mode: "archive" })
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        {open ? (
                          catItems.length ? (
                            <PosSortableList
                              ids={catItems.map((i) => i.id)}
                              onReorder={(ids) => {
                                const others = items.filter((i) => i.categoryId !== catId);
                                const inCat = new Map(
                                  items.filter((i) => i.categoryId === catId).map((i) => [i.id, i]),
                                );
                                const reordered = ids
                                  .map((id, i) => {
                                    const row = inCat.get(id);
                                    return row
                                      ? { ...row, sortOrder: (i + 1) * 1000, categoryId: catId }
                                      : null;
                                  })
                                  .filter((i): i is NonNullable<typeof i> => !!i);
                                const nextItems = [...others, ...reordered];
                                setItems(nextItems);
                                publishLocalMenuOrder({
                                  categories,
                                  items: nextItems,
                                  optionGroups,
                                });
                                void reorderMenuItemsInCategory(catId, ids).catch(() => {
                                  /* คงลำดับในเครื่อง — จะซิงก์รอบถัดไป */
                                });
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
                                        {item.name}
                                        {isItemArchived(item)
                                          ? " (เก็บแล้ว)"
                                          : !item.active
                                            ? " (หมด)"
                                            : ""}
                                      </span>
                                      <span className="muted">
                                        ฿{formatPlainNumber(item.price)}
                                        {" · ส่ง ฿"}
                                        {formatPlainNumber(
                                          typeof item.deliveryPrice === "number"
                                            ? item.deliveryPrice
                                            : item.price,
                                        )}
                                        {item.code ? ` · ${item.code}` : ""}
                                      </span>
                                    </button>
                                    {!isItemArchived(item) ? (
                                      <button
                                        type="button"
                                        className="pos-menu-inline-btn"
                                        aria-label="สำเนา"
                                        disabled={busy}
                                        onClick={() => {
                                          void (async () => {
                                            setBusy(true);
                                            setError(null);
                                            try {
                                              const id = await duplicateMenuItem(item);
                                              setExpandedCat(item.categoryId);
                                              setScreen({ kind: "edit-item", id });
                                            } catch (err) {
                                              setError((err as Error).message);
                                            } finally {
                                              setBusy(false);
                                            }
                                          })();
                                        }}
                                      >
                                        <Copy size={12} />
                                      </button>
                                    ) : null}
                                    {isItemArchived(item) ? (
                                      <>
                                        <button
                                          type="button"
                                          className="pos-menu-inline-btn"
                                          aria-label="กู้คืน"
                                          disabled={busy}
                                          onClick={() => {
                                            void restoreMenuItem(item.id).catch((err) =>
                                              setError((err as Error).message),
                                            );
                                          }}
                                        >
                                          <RotateCcw size={12} />
                                        </button>
                                        <button
                                          type="button"
                                          className="pos-menu-inline-btn"
                                          aria-label="ลบถาวร"
                                          disabled={busy}
                                          onClick={() =>
                                            setDeleteTarget({ kind: "item", item, mode: "hard" })
                                          }
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        className="pos-menu-inline-btn"
                                        aria-label="แก้ไข"
                                        onClick={() => setScreen({ kind: "edit-item", id: item.id })}
                                      >
                                        <Pencil size={12} />
                                      </button>
                                    )}
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
              <p className="muted pos-menu-sort-hint">
                กด ↑↓ เลื่อนลำดับกลุ่มตัวเลือก · จำขึ้น Firebase เงียบๆ
              </p>
              {optionGroups.length ? (
                <PosSortableList
                  ids={groupIds}
                  onReorder={(ids) => {
                    const map = new Map(optionGroups.map((g) => [g.id, g]));
                    const nextGroups = ids
                      .map((id, i) => {
                        const row = map.get(id);
                        return row ? { ...row, sortOrder: (i + 1) * 1000 } : null;
                      })
                      .filter((g): g is NonNullable<typeof g> => !!g);
                    setOptionGroups(nextGroups);
                    publishLocalMenuOrder({
                      categories,
                      items,
                      optionGroups: nextGroups,
                    });
                    void reorderMenuOptionGroups(ids).catch(() => {
                      /* คงลำดับในเครื่อง — จะซิงก์รอบถัดไป */
                    });
                  }}
                  className="pos-menu-group-list"
                  renderItem={(groupId) => {
                    const group = visibleGroups.find((g) => g.id === groupId);
                    if (!group) return null;
                    const archived = isGroupArchived(group);
                    return (
                      <div className="pos-menu-group-row">
                        <button
                          type="button"
                          className="pos-menu-group-main"
                          onClick={() => setScreen({ kind: "edit-group", id: group.id })}
                        >
                          <span className="pos-menu-group-title">
                            {group.name}
                            {archived ? " (เก็บแล้ว)" : ""}
                            {group.required ? (
                              <span className="pos-menu-badge pos-menu-badge--req">จำเป็น</span>
                            ) : null}
                          </span>
                          <span className="muted">
                            {group.options.length} ตัวเลือก · ใช้กับ{" "}
                            {countMenusUsingGroup(items, group.id)} เมนู
                          </span>
                        </button>
                        {!archived ? (
                          <>
                            <button
                              type="button"
                              className="pos-menu-inline-btn"
                              aria-label="ผูกเมนู"
                              title="ผูกเมนู"
                              onClick={() => openLinkMenus(group.id)}
                            >
                              <Link2 size={12} />
                            </button>
                            <button
                              type="button"
                              className="pos-menu-inline-btn"
                              aria-label="สำเนา"
                              disabled={busy}
                              onClick={() => {
                                void (async () => {
                                  setBusy(true);
                                  setError(null);
                                  try {
                                    const id = await duplicateMenuOptionGroup(group);
                                    setScreen({ kind: "edit-group", id });
                                  } catch (err) {
                                    setError((err as Error).message);
                                  } finally {
                                    setBusy(false);
                                  }
                                })();
                              }}
                            >
                              <Copy size={12} />
                            </button>
                          </>
                        ) : null}
                        {archived ? (
                          <>
                            <button
                              type="button"
                              className="pos-menu-inline-btn"
                              aria-label="กู้คืน"
                              disabled={busy}
                              onClick={() => {
                                void restoreMenuOptionGroup(group.id).catch((err) =>
                                  setError((err as Error).message),
                                );
                              }}
                            >
                              <RotateCcw size={12} />
                            </button>
                            <button
                              type="button"
                              className="pos-menu-inline-btn"
                              aria-label="ลบถาวร"
                              disabled={busy}
                              onClick={() =>
                                setDeleteTarget({ kind: "group", group, mode: "hard" })
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="pos-menu-inline-btn"
                            aria-label="แก้ไข"
                            onClick={() => setScreen({ kind: "edit-group", id: group.id })}
                          >
                            <Pencil size={12} />
                          </button>
                        )}
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
              <>
                <div className="pos-menu-price-row">
                  <label>
                    <span>ราคาหน้าร้าน (฿)</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={quickPrice}
                      onChange={(e) => setQuickPrice(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    <span>ราคาเดลิเวอรี่ (฿)</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={quickDeliveryPrice}
                      onChange={(e) => setQuickDeliveryPrice(e.target.value)}
                      placeholder="ว่าง = ใช้หน้าร้าน"
                    />
                  </label>
                </div>
                <p className="muted pos-menu-quick-hint">
                  หลังกดเพิ่ม จะเปิดตั้งค่ารูป · รายละเอียด · ช่องทางขาย · กลุ่มตัวเลือกทันที
                </p>
              </>
            ) : null}
            <div className="pos-menu-editor-actions">
              <button type="button" className="ghost-btn pos-menu-btn-sm" onClick={() => setQuickAdd(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="primary-btn pos-menu-btn-sm" disabled={busy}>
                {busy ? "กำลังเพิ่ม..." : quickAdd.kind === "item" ? "เพิ่มแล้วตั้งค่าต่อ" : "เพิ่ม"}
              </button>
            </div>
          </form>
        </PosMenuModal>
      ) : null}

      {screen.kind === "edit-item" && !editItem ? (
        <PosMenuModal title="ตั้งค่าเมนูใหม่" onClose={() => setScreen({ kind: "list" })} wide>
          <p className="muted pos-menu-edit-loading">กำลังโหลดเมนูที่เพิ่งสร้าง...</p>
        </PosMenuModal>
      ) : null}

      {editItem ? (
        <PosMenuModal
          title={editingFreshItem ? "ตั้งค่าเมนูใหม่" : "แก้ไขเมนู"}
          onClose={() => {
            setFreshItemId(null);
            setScreen({ kind: "list" });
          }}
          wide
        >
          <PosMenuItemEditor
            modal
            item={editItem}
            categories={categories}
            optionGroups={optionGroups}
            onBack={() => {
              setFreshItemId(null);
              setScreen({ kind: "list" });
            }}
            onSaved={() => {
              setFreshItemId(null);
              setScreen({ kind: "list" });
            }}
            onDelete={() => setDeleteTarget({ kind: "item", item: editItem, mode: "archive" })}
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
            onDelete={() => setDeleteTarget({ kind: "group", group: editGroup, mode: "archive" })}
          />
        </PosMenuModal>
      ) : null}

      {renameCategory ? (
        <PosMenuModal title="แก้ชื่อหมวด" onClose={() => setRenameCategory(null)}>
          <form
            className="pos-menu-quick-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renameValue.trim()) return;
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await updateMenuCategory(renameCategory.id, { name: renameValue.trim() });
                  setRenameCategory(null);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label>
              <span>ชื่อหมวด</span>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                required
                autoFocus
              />
            </label>
            <div className="pos-menu-editor-actions">
              <button type="button" className="ghost-btn pos-menu-btn-sm" onClick={() => setRenameCategory(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="primary-btn pos-menu-btn-sm" disabled={busy}>
                {busy ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </form>
        </PosMenuModal>
      ) : null}

      {linkGroup ? (
        <PosMenuModal
          title={`ผูกเมนู · ${linkGroup.name}`}
          onClose={() => setLinkGroupId(null)}
          wide
        >
          <div className="pos-menu-link-modal">
            <p className="muted">เลือกเมนูที่ต้องการผูกกับกลุ่มตัวเลือกนี้</p>
            <input
              type="search"
              className="pos-menu-search"
              placeholder="ค้นหาเมนู..."
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
            />
            <ul className="pos-menu-link-pick-list">
              {linkCandidates.map((item) => {
                const checked = linkSelected.has(item.id);
                const catName = categories.find((c) => c.id === item.categoryId)?.name || "";
                return (
                  <li key={item.id}>
                    <label className="pos-menu-toggle-row">
                      <span>
                        {item.name}
                        {catName ? <span className="muted"> · {catName}</span> : null}
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setLinkSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                      />
                    </label>
                  </li>
                );
              })}
              {!linkCandidates.length ? <li className="muted">ไม่พบเมนู</li> : null}
            </ul>
            <div className="pos-menu-editor-actions">
              <button
                type="button"
                className="ghost-btn pos-menu-btn-sm"
                onClick={() => setLinkGroupId(null)}
              >
                กลับ
              </button>
              <button
                type="button"
                className="primary-btn pos-menu-btn-sm"
                disabled={linkBusy}
                onClick={() => void saveLinkMenus()}
              >
                {linkBusy ? "กำลังบันทึก..." : `บันทึก (${linkSelected.size})`}
              </button>
            </div>
          </div>
        </PosMenuModal>
      ) : null}

      <PosConfirmDialog
        open={deleteTarget !== null}
        title={
          deleteTarget?.kind === "item"
            ? deleteTarget.mode === "hard"
              ? `ลบถาวร "${deleteTarget.item.name}"?`
              : `เก็บเมนู "${deleteTarget.item.name}"?`
            : deleteTarget?.kind === "group"
              ? deleteTarget.mode === "hard"
                ? `ลบถาวรกลุ่ม "${deleteTarget.group.name}"?`
                : `เก็บกลุ่ม "${deleteTarget.group.name}"?`
              : deleteTarget?.kind === "category"
                ? `เก็บหมวด "${deleteTarget.category.name}"?`
                : ""
        }
        message={
          deleteTarget?.mode === "hard"
            ? "รายการที่ลบแล้วกู้คืนไม่ได้"
            : deleteTarget?.kind === "category"
              ? "จะซ่อนหมวดจากลิสต์ใช้งาน — เมนูในหมวดยังอยู่ · กู้คืนได้จากตัวกรอง «เก็บแล้ว»"
              : "จะซ่อนจากหน้าขาย — กู้คืนได้จากตัวกรอง «เก็บแล้ว»"
        }
        confirmLabel={deleteTarget?.mode === "hard" ? "ลบถาวร" : "เก็บเข้าคลัง"}
        destructive
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void (async () => {
            setBusy(true);
            try {
              if (deleteTarget.kind === "item") {
                if (deleteTarget.mode === "hard") await deleteMenuItem(deleteTarget.item.id);
                else await archiveMenuItem(deleteTarget.item.id);
              } else if (deleteTarget.kind === "group") {
                if (deleteTarget.mode === "hard") await deleteMenuOptionGroup(deleteTarget.group.id);
                else await archiveMenuOptionGroup(deleteTarget.group.id);
              } else {
                await archiveMenuCategory(deleteTarget.category.id);
              }
              setDeleteTarget(null);
              setScreen({ kind: "list" });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
    </div>
  );
}
