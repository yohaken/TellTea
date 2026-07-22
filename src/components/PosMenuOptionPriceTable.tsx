"use client";

import { useMemo, useState } from "react";
import { saveMenuOptionGroupFull } from "@/lib/pos-menu-options";
import { menuTextIncludes } from "@/lib/pos-menu-text";
import type { MenuOptionChoice, MenuOptionGroup } from "@/lib/types";

type Row = {
  groupId: string;
  groupName: string;
  choice: MenuOptionChoice;
};

/**
 * Q4 — ตารางตั้งราคาตัวเลือก (หน้าร้าน × เดลิเวอรี่) ทั้งร้าน
 */
export function PosMenuOptionPriceTable({
  optionGroups,
  onSaved,
}: {
  optionGroups: MenuOptionGroup[];
  onSaved?: () => void;
}) {
  const activeGroups = useMemo(
    () => optionGroups.filter((g) => g.active !== false),
    [optionGroups],
  );

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, { store: string; delivery: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of activeGroups) {
      for (const c of g.options) {
        out.push({ groupId: g.id, groupName: g.name, choice: c });
      }
    }
    if (!query.trim()) return out;
    return out.filter(
      (r) => menuTextIncludes(r.choice.name, query) || menuTextIncludes(r.groupName, query),
    );
  }, [activeGroups, query]);

  function rowKey(r: Row) {
    return `${r.groupId}::${r.choice.id}`;
  }

  function getDraft(r: Row) {
    const key = rowKey(r);
    return (
      draft[key] || {
        store: String(r.choice.priceDelta ?? 0),
        delivery:
          typeof r.choice.deliveryPriceDelta === "number"
            ? String(r.choice.deliveryPriceDelta)
            : "",
      }
    );
  }

  function setCell(r: Row, field: "store" | "delivery", value: string) {
    const key = rowKey(r);
    const cur = getDraft(r);
    setDraft((prev) => ({ ...prev, [key]: { ...cur, [field]: value } }));
    setOk(null);
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const dirtyGroupIds = new Set<string>();
      for (const key of Object.keys(draft)) {
        dirtyGroupIds.add(key.split("::")[0]!);
      }
      if (!dirtyGroupIds.size) {
        setOk("ไม่มีรายการที่แก้");
        return;
      }
      for (const groupId of dirtyGroupIds) {
        const group = activeGroups.find((g) => g.id === groupId);
        if (!group) continue;
        const options = group.options.map((c) => {
          const key = `${groupId}::${c.id}`;
          const d = draft[key];
          if (!d) return c;
          const deliveryRaw = d.delivery.trim();
          return {
            ...c,
            priceDelta: Math.max(0, Number(d.store) || 0),
            deliveryPriceDelta:
              deliveryRaw === "" ? undefined : Math.max(0, Number(deliveryRaw) || 0),
          };
        });
        await saveMenuOptionGroupFull(groupId, {
          name: group.name,
          required: group.required,
          selectionType: group.selectionType,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options,
        });
      }
      setDraft({});
      setOk(`บันทึก ${dirtyGroupIds.size} กลุ่มแล้ว`);
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
        ตั้งราคาเพิ่มของตัวเลือก · หน้าร้าน | เดลิเวอรี่ · คอลัมน์เดลิเวอรี่ว่างหรือ placeholder «ส่ง» =
        ใช้ราคาหน้าร้าน · ไม่มี CSV
      </p>
      <div className="pos-menu-toolbar">
        <input
          type="search"
          className="pos-menu-search"
          placeholder="ค้นหาตัวเลือกหรือกลุ่ม..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="ค้นหาตัวเลือก"
        />
        <button
          type="button"
          className="primary-btn pos-menu-btn-sm"
          disabled={busy || !Object.keys(draft).length}
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
              <th>ตัวเลือก</th>
              <th>กลุ่ม</th>
              <th>หน้าร้าน (฿)</th>
              <th>เดลิเวอรี่ (฿)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = getDraft(r);
              return (
                <tr key={rowKey(r)}>
                  <td>
                    {r.choice.name || "—"}
                    {r.choice.active === false ? (
                      <span className="muted"> (ปิดขาย)</span>
                    ) : null}
                  </td>
                  <td className="muted">{r.groupName}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={d.store}
                      onChange={(e) => setCell(r, "store", e.target.value)}
                      aria-label={`หน้าร้าน ${r.choice.name}`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={d.delivery}
                      placeholder="ส่ง"
                      title="ว่าง = ใช้ราคาหน้าร้าน"
                      onChange={(e) => setCell(r, "delivery", e.target.value)}
                      aria-label={`เดลิเวอรี่ ${r.choice.name}`}
                    />
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="muted">
                  ไม่พบตัวเลือก
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
