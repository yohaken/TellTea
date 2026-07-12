"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  createStockItem,
  deleteStockItem,
  seedStockItemsIfEmpty,
  subscribeStockItems,
  updateStockItem,
} from "@/lib/stock";
import {
  importStockCsvText,
  parseStockCsv,
  previewStockImportLabel,
} from "@/lib/stock-import";
import type { StockItem } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

function monthInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function StockCatalogSetup({ onError }: { onError: (msg: string) => void }) {
  const { user } = useAuth();
  const userEmail = user?.email || "";
  const [items, setItems] = useState<StockItem[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ชิ้น");
  const [minQty, setMinQty] = useState("0");
  const [safetyStock, setSafetyStock] = useState("0");
  const [unitCost, setUnitCost] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [importMonth, setImportMonth] = useState(monthInputValue());
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const csvTextRef = useRef("");

  useEffect(() => {
    if (!userEmail) return;
    void seedStockItemsIfEmpty(userEmail).catch(() => undefined);
    const unsub = subscribeStockItems(
      (rows) => setItems(rows),
      (err) => onError(err.message),
    );
    return unsub;
  }, [userEmail, onError]);

  async function onPickCsv(file: File) {
    const text = await file.text();
    const [y, m] = importMonth.split("-").map(Number);
    const preview = parseStockCsv(text, y, m);
    if (!preview.products.length) {
      onError(
        preview.skipped.length
          ? `อ่านไฟล์ไม่ได้ — ข้าม ${preview.skipped.length} แถว`
          : "ไม่พบรายการในไฟล์",
      );
      setImportPreview(null);
      return;
    }
    onError("");
    setImportPreview(previewStockImportLabel(preview));
    csvTextRef.current = text;
  }

  async function onImportCsv() {
    const text = csvTextRef.current;
    if (!text || !userEmail) {
      onError("เลือกไฟล์ CSV ก่อน");
      return;
    }
    if (!window.confirm("นำเข้าข้อมูลจาก CSV? (อัปเดตรายการที่ชื่อตรงกัน · ไม่ลบของเดิม)")) return;
    setImportBusy(true);
    onError("");
    try {
      const [y, m] = importMonth.split("-").map(Number);
      const result = await importStockCsvText(text, userEmail, y, m);
      setImportPreview(
        `นำเข้าแล้ว — สร้าง ${result.productsCreated} · อัปเดต ${result.productsUpdated} · ประวัติ ${result.movements}` +
          (result.parseSkipped ? ` · ข้าม ${result.parseSkipped} แถว` : ""),
      );
    } catch (err) {
      onError((err as Error).message || "นำเข้าไม่สำเร็จ");
    } finally {
      setImportBusy(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!userEmail) return;
    setBusy(true);
    onError("");
    try {
      await createStockItem({
        name,
        unit,
        qty: 0,
        minQty: Number(minQty),
        safetyStock: Number(safetyStock),
        unitCost: Number(unitCost),
        barcode,
        updatedBy: userEmail,
      });
      setName("");
      setBarcode("");
    } catch (err) {
      onError((err as Error).message || "เพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function saveField(item: StockItem, field: keyof StockItem, value: string) {
    if (!userEmail) return;
    onError("");
    try {
      const patch: Record<string, unknown> = { updatedBy: userEmail };
      if (field === "name") patch.name = value;
      if (field === "unit") patch.unit = value;
      if (field === "minQty") patch.minQty = Number(value);
      if (field === "safetyStock") patch.safetyStock = Number(value);
      if (field === "unitCost") patch.unitCost = Number(value);
      if (field === "barcode") patch.barcode = value;
      await updateStockItem(item.id, patch as Parameters<typeof updateStockItem>[1]);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    }
  }

  return (
    <section className="owner-settings-section">
      <h2 className="owner-settings-title">คลังวัตถุดิบ</h2>
      <p className="muted owner-settings-hint">
        รายการสินค้าสำหรับตารางนับสต๊อก · พนักงานนับที่หน้า คลังวัตถุดิบ
      </p>

      <div className="form-card entry-form check-import-card">
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>นำเข้า CSV สต๊อก</h3>
        <p className="muted check-hint">
          เลือกไฟล์จาก Google Sheet (TELL TEA - สต๊อกสินค้า.csv) — รองรับทั้งตารางเช็คทุก 10 วัน
          (คอลัมน์วันที่) และรายการคงเหลือตรงๆ
        </p>
        <div className="check-import-row">
          <input
            type="month"
            className="ot-slim-input"
            value={importMonth}
            onChange={(e) => setImportMonth(e.target.value)}
            aria-label="เดือนอ้างอิงสำหรับคอลัมน์วันที่"
          />
          <label className="check-import-file">
            <input
              type="file"
              accept=".csv,text/csv"
              className="check-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickCsv(f).catch((err) => onError((err as Error).message));
              }}
            />
            เลือก CSV
          </label>
          <button
            type="button"
            className="primary-btn"
            disabled={importBusy || !importPreview}
            onClick={() => void onImportCsv()}
          >
            {importBusy ? "กำลังนำเข้า..." : "นำเข้า"}
          </button>
        </div>
        {importPreview ? <p className="muted check-import-preview">{importPreview}</p> : null}
      </div>

      <form className="form-card entry-form" onSubmit={(e) => void onCreate(e)}>
        <h3 className="panel-title" style={{ fontSize: "1rem" }}>เพิ่มวัตถุดิบ</h3>
        <div className="field">
          <label htmlFor="stock-setup-name">ชื่อ</label>
          <input id="stock-setup-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="stock-setup-unit">หน่วย</label>
            <input id="stock-setup-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="stock-setup-reorder">จุดสั่งซื้อ</label>
            <input id="stock-setup-reorder" type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="stock-setup-safety">สต๊อกสำรอง</label>
            <input id="stock-setup-safety" type="number" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} />
          </div>
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="stock-setup-cost">ราคา/หน่วย (บาท)</label>
            <input id="stock-setup-cost" type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="stock-setup-barcode">บาร์โค้ด</label>
            <input id="stock-setup-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังเพิ่ม..." : "เพิ่มรายการ"}
        </button>
      </form>

      <div className="list-card stock-setup-list" style={{ marginTop: "0.75rem" }}>
        <h3 className="panel-title" style={{ fontSize: "0.95rem" }}>รายการวัตถุดิบ ({items.length})</h3>
        {items.map((item) => (
          <div key={item.id} className="stock-setup-row">
            <input
              className="stock-setup-name"
              defaultValue={item.name}
              onBlur={(e) => {
                if (e.target.value !== item.name) void saveField(item, "name", e.target.value);
              }}
            />
            <div className="stock-setup-grid">
              <label>
                หน่วย
                <input
                  defaultValue={item.unit}
                  onBlur={(e) => {
                    if (e.target.value !== item.unit) void saveField(item, "unit", e.target.value);
                  }}
                />
              </label>
              <label>
                สั่งซื้อ ≤
                <input
                  type="number"
                  defaultValue={item.minQty}
                  key={`min-${item.id}-${item.minQty}`}
                  onBlur={(e) => {
                    if (Number(e.target.value) !== item.minQty) void saveField(item, "minQty", e.target.value);
                  }}
                />
              </label>
              <label>
                สำรอง
                <input
                  type="number"
                  defaultValue={item.safetyStock}
                  key={`safe-${item.id}-${item.safetyStock}`}
                  onBlur={(e) => {
                    if (Number(e.target.value) !== item.safetyStock) {
                      void saveField(item, "safetyStock", e.target.value);
                    }
                  }}
                />
              </label>
              <label>
                ฿/หน่วย
                <input
                  type="number"
                  step="0.01"
                  defaultValue={item.unitCost}
                  key={`cost-${item.id}-${item.unitCost}`}
                  onBlur={(e) => {
                    if (Number(e.target.value) !== item.unitCost) void saveField(item, "unitCost", e.target.value);
                  }}
                />
              </label>
              <label className="wide">
                บาร์โค้ด
                <input
                  defaultValue={item.barcode || ""}
                  onBlur={(e) => {
                    if (e.target.value !== (item.barcode || "")) void saveField(item, "barcode", e.target.value);
                  }}
                />
              </label>
            </div>
            <div className="stock-setup-meta muted">
              คงเหลือ {formatPlainNumber(item.qty)} {item.unit}
              <button
                type="button"
                className="danger-btn"
                onClick={() =>
                  void deleteStockItem(item.id).catch((err) =>
                    onError((err as Error).message || "ลบไม่สำเร็จ"),
                  )
                }
              >
                ลบ
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
