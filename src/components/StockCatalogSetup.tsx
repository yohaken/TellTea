"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  adjustStockQty,
  createStockItem,
  deleteStockItem,
  migrateAllLegacyStockCosts,
  seedStockItemsIfEmpty,
  subscribeStockItemsWithCosts,
  updateStockItem,
} from "@/lib/stock";
import {
  guessStockIconId,
  STOCK_ICON_OPTIONS,
  stockIconComponent,
  type StockIconId,
} from "@/lib/stock-icons";
import type { StockItem } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

/**
 * รายการวัตถุดิบ — เจ้าของเท่านั้น · super compact
 * เพิ่มชื่อ · ไอคอน · เกณฑ์แจ้งเตือน (≤) · ลบ
 */
export function StockCatalogSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const userEmail = actorId;
  const [items, setItems] = useState<StockItem[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ชิ้น");
  const [minQty, setMinQty] = useState("0");
  const [icon, setIcon] = useState<StockIconId>("bag");
  const [busy, setBusy] = useState(false);
  const [qtyBusyId, setQtyBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!userEmail) return;
    void (async () => {
      try {
        await seedStockItemsIfEmpty(userEmail);
      } catch {
        /* ignore */
      }
      try {
        await migrateAllLegacyStockCosts();
      } catch {
        /* best-effort */
      }
    })();
    const unsub = subscribeStockItemsWithCosts(
      (rows) => setItems(rows),
      (err) => onError(err.message),
    );
    return unsub;
  }, [userEmail, onError]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!userEmail) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    onError(null);
    try {
      await createStockItem({
        name: trimmed,
        unit: unit.trim() || "ชิ้น",
        qty: 0,
        minQty: Number(minQty) || 0,
        safetyStock: 0,
        unitCost: 0,
        icon: icon || guessStockIconId(trimmed),
        updatedBy: userEmail,
      });
      setName("");
      setMinQty("0");
      setIcon("bag");
    } catch (err) {
      onError((err as Error).message || "เพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function saveField(item: StockItem, field: keyof StockItem, value: string) {
    if (!userEmail) return;
    onError(null);
    try {
      const patch: Record<string, unknown> = { updatedBy: userEmail };
      if (field === "name") patch.name = value;
      if (field === "unit") patch.unit = value;
      if (field === "minQty") patch.minQty = Number(value);
      if (field === "icon") patch.icon = value;
      await updateStockItem(item.id, patch as Parameters<typeof updateStockItem>[1]);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    }
  }

  async function onAdjustQty(item: StockItem, delta: number) {
    if (!userEmail || qtyBusyId) return;
    if (delta < 0 && item.qty <= 0) return;
    setQtyBusyId(item.id);
    onError(null);
    try {
      await adjustStockQty(item.id, delta, userEmail);
    } catch (err) {
      onError((err as Error).message || "ปรับจำนวนไม่สำเร็จ");
    } finally {
      setQtyBusyId(null);
    }
  }

  async function onDelete(item: StockItem) {
    if (!window.confirm(`ลบ「${item.name}」?`)) return;
    onError(null);
    try {
      await deleteStockItem(item.id);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  return (
    <section className="stock-catalog-panel stock-catalog-panel--slim">
      <form
        className="stock-catalog-add"
        onSubmit={(e) => void onCreate(e)}
        aria-label="เพิ่มวัตถุดิบ"
      >
        <StockIconSelect value={icon} onChange={setIcon} ariaLabel="ไอคอนรายการใหม่" />
        <input
          className="stock-catalog-add-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!e.target.value.trim()) return;
            setIcon(guessStockIconId(e.target.value));
          }}
          placeholder="ชื่อวัตถุดิบ"
          required
          aria-label="ชื่อวัตถุดิบ"
        />
        <input
          className="stock-catalog-add-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="หน่วย"
          aria-label="หน่วย"
        />
        <label className="stock-catalog-add-alert">
          ≤
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
            aria-label="แจ้งเตือนเมื่อจำนวนน้อยกว่าหรือเท่ากับ"
          />
        </label>
        <button type="submit" className="primary-btn stock-catalog-add-btn" disabled={busy}>
          {busy ? "…" : "+"}
        </button>
      </form>

      <p className="muted stock-catalog-lead">
        แจ้งเตือนเมื่อคงเหลือ ≤ ค่าที่ตั้ง · {items.length} รายการ
      </p>

      <ul className="stock-catalog-list">
        {items.length === 0 ? (
          <li className="empty stock-catalog-empty">ยังไม่มีรายการ</li>
        ) : null}
        {items.map((item) => {
          const qtyBusy = qtyBusyId === item.id;
          const low = item.minQty > 0 && item.qty <= item.minQty;
          const Icon = stockIconComponent(item.icon);
          return (
            <li
              key={item.id}
              className={low ? "stock-catalog-row is-low" : "stock-catalog-row"}
            >
              <StockIconSelect
                value={(item.icon as StockIconId) || "bag"}
                onChange={(next) => void saveField(item, "icon", next)}
                ariaLabel={`ไอคอน ${item.name}`}
              />
              <input
                className="stock-catalog-row-name"
                defaultValue={item.name}
                key={`name-${item.id}-${item.name}`}
                aria-label={`ชื่อ ${item.name}`}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== item.name) void saveField(item, "name", next);
                  else if (!next) e.target.value = item.name;
                }}
              />
              <div className="stock-catalog-qty" aria-label={`คงเหลือ ${item.name}`}>
                <button
                  type="button"
                  className="stock-catalog-qty-btn"
                  disabled={qtyBusy || item.qty <= 0}
                  aria-label="ลด 1"
                  onClick={() => void onAdjustQty(item, -1)}
                >
                  <Minus size={11} aria-hidden />
                </button>
                <span className={low ? "stock-catalog-qty-val is-low" : "stock-catalog-qty-val"}>
                  <Icon size={11} aria-hidden className="stock-catalog-qty-icon" />
                  {formatPlainNumber(item.qty)}
                  <span className="muted">{item.unit}</span>
                </span>
                <button
                  type="button"
                  className="stock-catalog-qty-btn"
                  disabled={qtyBusy}
                  aria-label="เพิ่ม 1"
                  onClick={() => void onAdjustQty(item, 1)}
                >
                  <Plus size={11} aria-hidden />
                </button>
              </div>
              <label className="stock-catalog-row-alert" title="แจ้งเตือนเมื่อ ≤">
                ≤
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  defaultValue={item.minQty || ""}
                  key={`min-${item.id}-${item.minQty}`}
                  aria-label={`${item.name} แจ้งเตือนเมื่อน้อยกว่าหรือเท่ากับ`}
                  onBlur={(e) => {
                    if (Number(e.target.value) !== item.minQty) {
                      void saveField(item, "minQty", e.target.value);
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="trash-btn stock-catalog-del"
                aria-label={`ลบ ${item.name}`}
                onClick={() => void onDelete(item)}
              >
                <Trash2 size={11} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StockIconSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: StockIconId;
  onChange: (id: StockIconId) => void;
  ariaLabel: string;
}) {
  const Current = stockIconComponent(value);
  return (
    <label className="stock-icon-select" title="เลือกไอคอน">
      <Current size={12} aria-hidden />
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as StockIconId)}
      >
        {STOCK_ICON_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
