"use client";

import { useMemo, useState } from "react";
import { updateMenuItem } from "@/lib/pos-menu";
import { menuTextIncludes } from "@/lib/pos-menu-text";
import type { MenuCategory, MenuItem } from "@/lib/types";

/**
 * Bulk edit menu item storefront prices — flat list, search across categories.
 */
export function PosMenuItemPriceTable({
  items,
  categories,
  onSaved,
}: {
  items: MenuItem[];
  categories: MenuCategory[];
  onSaved?: () => void;
}) {
  const catName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const activeItems = useMemo(
    () =>
      items
        .filter((i) => !(i.active === false && i.visibleOnPos === false))
        .slice()
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, "th") ||
            (catName.get(a.categoryId) || "").localeCompare(catName.get(b.categoryId) || "", "th"),
        ),
    [items, catName],
  );

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const dirtyCount = Object.keys(draft).length;

  const rows = useMemo(() => {
    if (!query.trim()) return activeItems;
    return activeItems.filter(
      (i) =>
        menuTextIncludes(i.name, query) ||
        menuTextIncludes(i.code || "", query) ||
        menuTextIncludes(catName.get(i.categoryId) || "", query),
    );
  }, [activeItems, query, catName]);

  function discardDraft() {
    if (!dirtyCount) return;
    if (!window.confirm(`ทิ้งร่างราคาเมนูที่แก้ไว้ ${dirtyCount} รายการ?`)) return;
    setDraft({});
    setOk(null);
    setError(null);
  }

  function getDraft(item: MenuItem) {
    return draft[item.id] ?? String(item.price ?? 0);
  }

  function setCell(item: MenuItem, value: string) {
    setDraft((prev) => ({ ...prev, [item.id]: value }));
    setOk(null);
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const ids = Object.keys(draft);
      if (!ids.length) {
        setOk("ไม่มีรายการที่แก้");
        return;
      }
      await Promise.all(
        ids.map((id) => {
          const raw = draft[id];
          if (raw === undefined) return Promise.resolve();
          return updateMenuItem(id, {
            price: Math.max(0, Number(raw) || 0),
          });
        }),
      );
      setDraft({});
      setOk(`บันทึก ${ids.length} เมนูแล้ว`);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-menu-price-table-wrap">
      <p className="muted pos-menu-sort-hint">
        ตั้งราคาเมนูทั้งร้านในตารางเดียว · ไม่แยกหมวด · ค้นหาชื่อ/รหัส/หมวดได้ · ราคาแอปส่งตั้งที่จัดการราคาช่องทาง
      </p>
      <div className="pos-menu-toolbar">
        <input
          type="search"
          className="pos-menu-search"
          placeholder="ค้นหาเมนู รหัส หรือหมวด..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="ค้นหาเมนู"
        />
        {dirtyCount ? (
          <button
            type="button"
            className="ghost-btn pos-menu-btn-sm"
            disabled={busy}
            onClick={discardDraft}
          >
            ทิ้งร่าง
          </button>
        ) : null}
        <button
          type="button"
          className="primary-btn pos-menu-btn-sm"
          disabled={busy || !dirtyCount}
          onClick={() => void saveAll()}
        >
          {busy ? "กำลังบันทึก..." : "บันทึกราคา"}
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {ok ? <p className="ok-text">{ok}</p> : null}

      <div className="pos-menu-price-table-scroll">
        <table className="pos-menu-price-table">
          <thead>
            <tr>
              <th>เมนู</th>
              <th>หมวด</th>
              <th>หน้าร้าน (฿)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const store = getDraft(item);
              return (
                <tr key={item.id}>
                  <td>
                    {item.name || "—"}
                    {!item.active ? <span className="muted"> (หมด)</span> : null}
                    {item.code ? <span className="muted"> · {item.code}</span> : null}
                  </td>
                  <td className="muted">{catName.get(item.categoryId) || "—"}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={store}
                      onChange={(e) => setCell(item, e.target.value)}
                      aria-label={`หน้าร้าน ${item.name}`}
                    />
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="muted">
                  ไม่พบเมนู
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="muted pos-menu-price-table-foot">{rows.length} รายการ</p>
    </div>
  );
}
