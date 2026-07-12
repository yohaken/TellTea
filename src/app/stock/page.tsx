"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Boxes,
  ClipboardList,
  ScanLine,
  Settings,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  computeUsageTrends,
  createStockItem,
  criticalStockItems,
  deleteStockItem,
  findStockByBarcode,
  pickCycleCountItem,
  recordCycleCount,
  recordStockIn,
  recordStockOut,
  seedStockItemsIfEmpty,
  subscribeStockItems,
  subscribeStockMovements,
  totalStockValue,
  updateStockItem,
  type ItemUsageTrend,
} from "@/lib/stock";
import type { StockItem, StockMovement } from "@/lib/types";
import {
  importStockCsvText,
  parseStockCsv,
  previewStockImportLabel,
} from "@/lib/stock-import";
import { formatBaht, formatPlainNumber, startOfLocalDay } from "@/lib/utils";

function monthInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

type Tab = "in" | "count" | "dashboard" | "setup";

export default function StockPage() {
  return (
    <AuthGate>
      <StockView />
    </AuthGate>
  );
}

function StockView() {
  const { user, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const canUseStock = can(staff, "stock");
  const [tab, setTab] = useState<Tab>("in");
  const [items, setItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff && !canUseStock) router.replace("/ledger/");
  }, [staff, router, canUseStock]);

  useEffect(() => {
    if (!canUseStock || !user?.email) return;
    setLoading(true);
    void seedStockItemsIfEmpty(user.email)
      .catch(() => undefined)
      .finally(() => setLoading(false));

    const unsubItems = subscribeStockItems(
      (rows) => setItems(rows),
      (err) => setError(err.message),
    );
    const since = startOfLocalDay(new Date(Date.now() - 60 * 86400000));
    const unsubMoves = subscribeStockMovements(
      (rows) => setMovements(rows),
      (err) => setError(err.message),
      { since },
    );
    return () => {
      unsubItems();
      unsubMoves();
    };
  }, [canUseStock, user?.email]);

  useEffect(() => {
    if (tab === "dashboard" || tab === "setup") {
      if (!isOwner) setTab("in");
    }
  }, [tab, isOwner]);

  const critical = useMemo(() => criticalStockItems(items), [items]);
  const stockValue = useMemo(() => totalStockValue(items), [items]);
  const trends = useMemo(() => computeUsageTrends(items, movements), [items, movements]);

  if (!canUseStock) return null;

  return (
    <div className="module-page stock-module">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <Boxes size={18} aria-hidden />
          คลังวัตถุดิบ
        </h1>
        <p className="muted stock-subtitle">Perpetual Inventory — บันทึกรับเข้า · ตรวจนับ · แจ้งเตือนอัตโนมัติ</p>
      </div>

      {critical.length > 0 ? (
        <div className="stock-critical-alert" role="alert">
          <AlertTriangle size={18} aria-hidden />
          <div>
            <strong>สต๊อกต่ำกว่าจุดสั่งซื้อ ({critical.length})</strong>
            <p>{critical.map((i) => i.name).join(" · ")}</p>
          </div>
        </div>
      ) : null}

      <StockTabDock tab={tab} isOwner={isOwner} onSelect={setTab} />

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && tab === "in" ? (
        <StockInTab items={items} userEmail={user?.email || ""} onError={setError} />
      ) : null}
      {!loading && tab === "count" ? (
        <CycleCountTab items={items} movements={movements} userEmail={user?.email || ""} onError={setError} />
      ) : null}
      {!loading && tab === "dashboard" && isOwner ? (
        <DashboardTab items={items} critical={critical} stockValue={stockValue} trends={trends} movements={movements} />
      ) : null}
      {!loading && tab === "setup" && isOwner ? (
        <SetupTab items={items} userEmail={user?.email || ""} onError={setError} />
      ) : null}
    </div>
  );
}

function StockTabDock({
  tab,
  isOwner,
  onSelect,
}: {
  tab: Tab;
  isOwner: boolean;
  onSelect: (t: Tab) => void;
}) {
  return (
    <div
      className={isOwner ? "stock-tab-dock is-owner" : "stock-tab-dock"}
      role="tablist"
      aria-label="เมนูคลัง"
    >
      <button
        type="button"
        role="tab"
        className={tab === "in" ? "module-tab is-active" : "module-tab"}
        aria-selected={tab === "in"}
        onClick={() => onSelect("in")}
      >
        <ArrowDownToLine size={14} aria-hidden /> รับเข้า
      </button>
      <button
        type="button"
        role="tab"
        className={tab === "count" ? "module-tab is-active" : "module-tab"}
        aria-selected={tab === "count"}
        onClick={() => onSelect("count")}
      >
        <ClipboardList size={14} aria-hidden /> ตรวจนับ
      </button>
      {isOwner ? (
        <>
          <button
            type="button"
            role="tab"
            className={tab === "dashboard" ? "module-tab is-active" : "module-tab"}
            aria-selected={tab === "dashboard"}
            onClick={() => onSelect("dashboard")}
          >
            <BarChart3 size={14} aria-hidden /> ภาพรวม
          </button>
          <button
            type="button"
            role="tab"
            className={tab === "setup" ? "module-tab is-active" : "module-tab"}
            aria-selected={tab === "setup"}
            onClick={() => onSelect("setup")}
          >
            <Settings size={14} aria-hidden /> ตั้งค่า
          </button>
        </>
      ) : null}
    </div>
  );
}

function ItemPicker({
  items,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  onScanOpen,
}: {
  items: StockItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onScanOpen: () => void;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.barcode && i.barcode.includes(q)),
    );
  }, [items, search]);

  return (
    <div className="stock-picker">
      <div className="stock-search-row">
        <input
          className="stock-search-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="ค้นหาวัตถุดิบ..."
          aria-label="ค้นหาวัตถุดิบ"
        />
        <button type="button" className="stock-scan-btn" onClick={onScanOpen} aria-label="สแกนบาร์โค้ด">
          <ScanLine size={20} />
        </button>
      </div>
      <div className="stock-picker-list">
        {filtered.map((item) => {
          const low = item.minQty > 0 && item.qty <= item.minQty;
          return (
            <button
              key={item.id}
              type="button"
              className={selectedId === item.id ? "stock-picker-item is-selected" : "stock-picker-item"}
              onClick={() => onSelect(item.id)}
            >
              <span>{item.name}</span>
              <span className={low ? "stock-picker-qty is-low" : "stock-picker-qty"}>
                {formatPlainNumber(item.qty)} {item.unit}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 ? <p className="empty">ไม่พบรายการ</p> : null}
      </div>
    </div>
  );
}

function StockInTab({
  items,
  userEmail,
  onError,
}: {
  items: StockItem[];
  userEmail: string;
  onError: (msg: string | null) => void;
}) {
  const [mode, setMode] = useState<"IN" | "OUT">("IN");
  const [selectedId, setSelectedId] = useState("");
  const [qty, setQty] = useState("");
  const [remark, setRemark] = useState("");
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const selected = items.find((i) => i.id === selectedId);

  const handleScan = useCallback(
    (code: string) => {
      const hit = findStockByBarcode(items, code);
      if (hit) {
        setSelectedId(hit.id);
        setSearch(hit.name);
      } else {
        setSearch(code);
        onError("ไม่พบวัตถุดิบจากบาร์โค้ดนี้");
      }
    },
    [items, onError],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected || !userEmail) return;
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) {
      onError("ใส่จำนวนที่ถูกต้อง");
      return;
    }
    setBusy(true);
    onError(null);
    setOk(null);
    try {
      if (mode === "IN") {
        await recordStockIn(selected.id, selected.name, amount, userEmail, userEmail, remark);
        setOk(`รับเข้า ${selected.name} +${amount} ${selected.unit}`);
      } else {
        await recordStockOut(selected.id, selected.name, amount, userEmail, userEmail, remark);
        setOk(`เบิกใช้ ${selected.name} −${amount} ${selected.unit}`);
      }
      setQty("");
      setRemark("");
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="stock-mode-toggle" role="group" aria-label="ประเภทการบันทึก">
        <button
          type="button"
          className={mode === "IN" ? "stock-mode-btn is-active" : "stock-mode-btn"}
          onClick={() => setMode("IN")}
        >
          <ArrowDownToLine size={16} /> รับเข้า
        </button>
        <button
          type="button"
          className={mode === "OUT" ? "stock-mode-btn is-active" : "stock-mode-btn"}
          onClick={() => setMode("OUT")}
        >
          <ArrowUpFromLine size={16} /> เบิกใช้
        </button>
      </div>

      <ItemPicker
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        search={search}
        onSearchChange={setSearch}
        onScanOpen={() => setScanOpen(true)}
      />

      {selected ? (
        <form className="form-card stock-action-card" onSubmit={(e) => void onSubmit(e)}>
          <p className="stock-action-selected">
            <strong>{selected.name}</strong>
            <span className="muted">คงเหลือ {formatPlainNumber(selected.qty)} {selected.unit}</span>
          </p>
          <div className="field">
            <label htmlFor="stock-in-qty">จำนวน{mode === "IN" ? "รับเข้า" : "เบิกใช้"}</label>
            <input
              id="stock-in-qty"
              type="number"
              step="0.01"
              min="0.01"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
              inputMode="decimal"
            />
          </div>
          <div className="field">
            <label htmlFor="stock-in-remark">หมายเหตุ (ถ้ามี)</label>
            <input
              id="stock-in-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder={mode === "IN" ? "เช่น ล็อตซัพพลายเออร์ A" : "เช่น ใช้ชงชาเขียว"}
            />
          </div>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : mode === "IN" ? "บันทึกรับเข้า" : "บันทึกเบิกใช้"}
          </button>
          {ok ? <p className="stock-ok">{ok}</p> : null}
        </form>
      ) : (
        <p className="empty">เลือกวัตถุดิบด้านบน หรือสแกนบาร์โค้ด</p>
      )}

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleScan} />
    </>
  );
}

function CycleCountTab({
  items,
  movements,
  userEmail,
  onError,
}: {
  items: StockItem[];
  movements: StockMovement[];
  userEmail: string;
  onError: (msg: string | null) => void;
}) {
  const [target, setTarget] = useState<StockItem | null>(null);
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);

  const pickRandom = useCallback(() => {
    setTarget(pickCycleCountItem(items, movements));
    setCounted("");
    setResult(null);
    onError(null);
  }, [items, movements, onError]);

  useEffect(() => {
    if (!target && items.length > 0) pickRandom();
  }, [target, items, pickRandom]);

  const handleScan = useCallback(
    (code: string) => {
      const hit = findStockByBarcode(items, code);
      if (hit) {
        setTarget(hit);
        setCounted("");
        setResult(null);
      } else {
        onError("ไม่พบวัตถุดิบจากบาร์โค้ดนี้");
      }
    },
    [items, onError],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target || !userEmail) return;
    const actual = Number(counted);
    if (!Number.isFinite(actual) || actual < 0) {
      onError("ใส่ยอดนับที่ถูกต้อง");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const { adjusted, delta } = await recordCycleCount(
        target.id,
        target.name,
        actual,
        target.qty,
        userEmail,
        userEmail,
      );
      if (adjusted) {
        setResult(`ปรับยอดแล้ว (${delta > 0 ? "+" : ""}${delta} ${target.unit}) — บันทึก ADJUST อัตโนมัติ`);
      } else {
        setResult("ยอดตรงกับระบบ — ไม่ต้องปรับ");
      }
      setTimeout(() => pickRandom(), 1200);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const manualPick = items.filter((i) =>
    !search.trim() ? true : i.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <div className="stock-count-toolbar">
        <button type="button" className="ghost-btn" onClick={pickRandom}>
          สุ่มรายการถัดไป
        </button>
        <button type="button" className="stock-scan-btn" onClick={() => setScanOpen(true)} aria-label="สแกน">
          <ScanLine size={20} />
        </button>
      </div>

      {target ? (
        <form className="form-card stock-count-card" onSubmit={(e) => void onSubmit(e)}>
          <p className="stock-count-label">ตรวจนับวันนี้</p>
          <h2 className="stock-count-name">{target.name}</h2>
          <div className="stock-count-system">
            <span className="muted">ยอดระบบ (คาดว่ามี)</span>
            <strong>{formatPlainNumber(target.qty)} {target.unit}</strong>
          </div>
          <div className="field">
            <label htmlFor="count-qty">ยอดจริงที่นับได้หน้างาน</label>
            <input
              id="count-qty"
              type="number"
              step="0.01"
              min="0"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              required
              inputMode="decimal"
              autoFocus
              placeholder="พิมพ์ยอดที่นับได้"
            />
          </div>
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "ยืนยันการนับ"}
          </button>
          {result ? <p className="stock-ok">{result}</p> : null}
        </form>
      ) : (
        <p className="empty">ยังไม่มีวัตถุดิบ — ให้เจ้าของตั้งค่าก่อน</p>
      )}

      <details className="stock-manual-pick">
        <summary>เลือกรายการเอง</summary>
        <input
          className="stock-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา..."
        />
        <div className="stock-picker-list compact">
          {manualPick.map((item) => (
            <button
              key={item.id}
              type="button"
              className="stock-picker-item"
              onClick={() => {
                setTarget(item);
                setCounted("");
                setResult(null);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      </details>

      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={handleScan} />
    </>
  );
}

function UsageChart({ trend, mode }: { trend: ItemUsageTrend; mode: "daily" | "weekly" }) {
  const points = mode === "daily" ? trend.daily : trend.weekly;
  const max = Math.max(1, ...points.map((p) => p.total));

  if (points.length === 0) {
    return <p className="muted stock-chart-empty">ยังไม่มีการเบิกใช้ในช่วงนี้</p>;
  }

  return (
    <div className="stock-chart" aria-label={`กราฟการใช้ ${trend.itemName}`}>
      <div className="stock-chart-bars">
        {points.map((p) => (
          <div key={p.label} className="stock-chart-col">
            <div
              className="stock-chart-bar"
              style={{ height: `${Math.max(4, (p.total / max) * 100)}%` }}
              title={`${p.label}: ${p.total}`}
            />
            <span className="stock-chart-label">{p.label}</span>
          </div>
        ))}
      </div>
      <p className="muted stock-chart-unit">หน่วย: {trend.unit}</p>
    </div>
  );
}

function DashboardTab({
  items,
  critical,
  stockValue,
  trends,
  movements,
}: {
  items: StockItem[];
  critical: StockItem[];
  stockValue: number;
  trends: ItemUsageTrend[];
  movements: StockMovement[];
}) {
  const [chartMode, setChartMode] = useState<"daily" | "weekly">("daily");
  const [chartItem, setChartItem] = useState("");
  const activeTrend = trends.find((t) => t.itemId === chartItem) || trends[0];
  const recentMoves = movements.slice(0, 15);

  useEffect(() => {
    if (!chartItem && items[0]) setChartItem(items[0].id);
  }, [chartItem, items]);

  return (
    <>
      <div className="stock-dash-cards">
        <div className="stock-dash-card">
          <span className="muted">มูลค่าคงคลังรวม</span>
          <strong>{stockValue > 0 ? formatBaht(stockValue) : "— ตั้งราคา/หน่วยในแท็บตั้งค่า"}</strong>
        </div>
        <div className="stock-dash-card">
          <span className="muted">รายการทั้งหมด</span>
          <strong>{items.length} ชนิด</strong>
        </div>
        <div className={`stock-dash-card ${critical.length ? "is-alert" : ""}`}>
          <span className="muted">ต่ำกว่าจุดสั่งซื้อ</span>
          <strong>{critical.length} รายการ</strong>
        </div>
      </div>

      {critical.length > 0 ? (
        <section className="list-card stock-critical-list">
          <h2 className="stock-section-title">
            <AlertTriangle size={16} /> Critical Alert
          </h2>
          {critical.map((item) => (
            <div key={item.id} className="stock-critical-row">
              <div>
                <strong>{item.name}</strong>
                <p className="muted">
                  เหลือ {formatPlainNumber(item.qty)} {item.unit} · สั่งซื้อเมื่อ ≤ {item.minQty}
                </p>
              </div>
              <span className="stock-badge-danger">ด่วน</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="list-card stock-chart-section">
        <div className="stock-chart-head">
          <h2 className="stock-section-title">
            <BarChart3 size={16} /> แนวโน้มการเบิกใช้
          </h2>
          <div className="stock-chart-toggle">
            <button
              type="button"
              className={chartMode === "daily" ? "stock-mode-btn is-active" : "stock-mode-btn"}
              onClick={() => setChartMode("daily")}
            >
              รายวัน
            </button>
            <button
              type="button"
              className={chartMode === "weekly" ? "stock-mode-btn is-active" : "stock-mode-btn"}
              onClick={() => setChartMode("weekly")}
            >
              รายสัปดาห์
            </button>
          </div>
        </div>
        <select
          className="stock-chart-select"
          value={activeTrend?.itemId || ""}
          onChange={(e) => setChartItem(e.target.value)}
          aria-label="เลือกวัตถุดิบ"
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {activeTrend ? <UsageChart trend={activeTrend} mode={chartMode} /> : null}
      </section>

      <section className="list-card">
        <h2 className="stock-section-title">ประวัติล่าสุด</h2>
        {recentMoves.length === 0 ? (
          <p className="empty">ยังไม่มีการขยับสต๊อก</p>
        ) : (
          <div className="stock-move-list">
            {recentMoves.map((m) => (
              <div key={m.id} className="stock-move-row">
                <span className={`stock-move-type is-${m.type.toLowerCase()}`}>{m.type}</span>
                <div>
                  <strong>{m.itemName}</strong>
                  <p className="muted">
                    {formatPlainNumber(m.quantity)} · {m.inspector}
                    {m.remark ? ` · ${m.remark}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SetupTab({
  items,
  userEmail,
  onError,
}: {
  items: StockItem[];
  userEmail: string;
  onError: (msg: string | null) => void;
}) {
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
    onError(null);
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
    onError(null);
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
    onError(null);
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
    onError(null);
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
    <>
      <div className="form-card entry-form check-import-card">
        <h2 className="stock-section-title">นำเข้า CSV สต๊อก</h2>
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

      <form className="form-card" onSubmit={(e) => void onCreate(e)}>
        <h2 className="stock-section-title">เพิ่มวัตถุดิบ</h2>
        <div className="field">
          <label htmlFor="setup-name">ชื่อ</label>
          <input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="setup-unit">หน่วย</label>
            <input id="setup-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="setup-reorder">จุดสั่งซื้อ</label>
            <input id="setup-reorder" type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="setup-safety">สต๊อกสำรอง</label>
            <input id="setup-safety" type="number" value={safetyStock} onChange={(e) => setSafetyStock(e.target.value)} />
          </div>
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="setup-cost">ราคา/หน่วย (บาท)</label>
            <input id="setup-cost" type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label htmlFor="setup-barcode">บาร์โค้ด</label>
            <input id="setup-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังเพิ่ม..." : "เพิ่มรายการ"}
        </button>
      </form>

      <div className="list-card stock-setup-list">
        <h2 className="stock-section-title">รายการวัตถุดิบ ({items.length})</h2>
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
    </>
  );
}
