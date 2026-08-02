"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Lock, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { ProdCatalogSetup } from "@/components/ProdCatalogSetup";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { PhotoForensicsPanel } from "@/components/PhotoForensicsPanel";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useAuth } from "@/lib/auth";
import { monthInputValue, parseMonthInput } from "@/lib/bonus";
import { resolveWorkerDisplayNames } from "@/lib/employee-rename-propagate";
import { resolveLinkedEmployee } from "@/lib/employees";
import { staffHomeHref } from "@/lib/nav-menu";
import { can } from "@/lib/permissions";
import {
  entryHasPhotoFlag,
  type PhotoForensicsReport,
} from "@/lib/photo-forensics-scan";
import {
  addProdEntry,
  computeProdBonus,
  deleteProdEntry,
  getProdImageUrls,
  isProdEntryLocked,
  labelProdStatus,
  listProdProducts,
  listProdWorkers,
  PROD_IMAGE_MAX,
  resolveProdEntryRates,
  seedProdCatalogIfEmpty,
  subscribeProdEntries,
  updateProdEntry,
  type ProdEntry,
  type ProdProduct,
  type ProdWorker,
} from "@/lib/production";
import {
  resolveRateForDate,
  subscribeRateSchedule,
  type RateScheduleEntry,
} from "@/lib/rate-schedule";
import {
  formatDateShortBe,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

type ProdOwnerView = "log" | "catalog";

export default function ProductionPage() {
  return (
    <AuthGate>
      <ProductionView />
    </AuthGate>
  );
}

function ProductionView() {
  const { actorId, staff, isPermPreview } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const shopProdView = isOwner || can(staff, "payrollPay");
  /** พรีวิว = มุมพนักงาน: ดู/เลือกเดือนได้ · กรอกไม่ได้ */
  const canWrite = !!actorId && !isPermPreview;
  const [ownerView, setOwnerView] = useState<ProdOwnerView>("log");
  const [formOpen, setFormOpen] = useState(false);
  const [entries, setEntries] = useState<ProdEntry[]>([]);
  const [products, setProducts] = useState<ProdProduct[]>([]);
  const [workers, setWorkers] = useState<ProdWorker[]>([]);
  const [logMonth, setLogMonth] = useState(monthInputValue());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProdEntry | null>(null);
  const [rateSchedule, setRateSchedule] = useState<RateScheduleEntry[]>([]);
  const { year: logYear, month: logMonthIdx } = parseMonthInput(logMonth);

  async function reloadCatalog() {
    const [p, w] = await Promise.all([listProdProducts(), listProdWorkers()]);
    setProducts(p);
    setWorkers(w);
  }

  useEffect(() => {
    if (staff && !can(staff, "production")) {
      router.replace(staffHomeHref(staff));
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "production")) return;
    setLoading(true);
    let cancelled = false;
    let unsubEntries: (() => void) | undefined;
    const unsubSchedule = subscribeRateSchedule(
      (doc) => setRateSchedule(doc.entries),
      (err) => setError(err.message),
    );

    void reloadCatalog()
      .then(async () => {
        if (isOwner) {
          const seeded = await seedProdCatalogIfEmpty();
          if (seeded.products || seeded.workers) await reloadCatalog();
        }
        if (cancelled) return;
        const w = await listProdWorkers();
        if (cancelled) return;
        setWorkers(w);
        // มุมพนักงาน/พรีวิว: กรองคนตัวเอง + เดือนที่เลือก (ไม่ดึง lookback ยาวที่ทำให้วันที่ดูแปลก)
        const filterId = shopProdView
          ? ""
          : staff?.employeeId || resolveLinkedEmployee(w, staff)?.id || "";
        const monthWindow = {
          since: new Date(logYear, logMonthIdx, 1).getTime(),
          until: new Date(logYear, logMonthIdx + 1, 1).getTime(),
        };
        if (!shopProdView && !filterId) {
          setEntries([]);
          return;
        }
        unsubEntries = subscribeProdEntries(
          (rows) => setEntries(rows),
          (err) => setError(err.message || "โหลดรายการไม่สำเร็จ"),
          shopProdView
            ? monthWindow
            : { ...monthWindow, workerId: filterId },
        );
      })
      .catch((err) => setError((err as Error).message || "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubEntries?.();
      unsubSchedule();
    };
  }, [staff, isOwner, shopProdView, logYear, logMonthIdx]);

  useBodyScrollLock(formOpen);

  if (!can(staff, "production")) return null;

  const activeProducts = products.filter((p) => p.active);
  const activeWorkers = workers.filter((w) => w.active);
  const showCatalog = isOwner && ownerView === "catalog";
  const showLog = !showCatalog;

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(row: ProdEntry) {
    setEditing(row);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  const ownerTabs = isOwner ? (
    <div className="stock-owner-tabs stock-owner-tabs--inline" role="tablist" aria-label="มุมมองผลิตเจ้าของ">
      <button
        type="button"
        role="tab"
        className={ownerView === "log" ? "stock-owner-tab is-active" : "stock-owner-tab"}
        aria-selected={ownerView === "log"}
        onClick={() => {
          setOwnerView("log");
          setFormOpen(false);
        }}
      >
        บันทึกผลิต
      </button>
      <button
        type="button"
        role="tab"
        className={ownerView === "catalog" ? "stock-owner-tab is-active" : "stock-owner-tab"}
        aria-selected={ownerView === "catalog"}
        onClick={() => {
          setOwnerView("catalog");
          setFormOpen(false);
        }}
      >
        สินค้า / เรท
        {products.length ? ` (${products.length})` : ""}
      </button>
    </div>
  ) : null;

  return (
    <div className="module-page production-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <ChefHat size={18} aria-hidden />
          ผลิต / โบนัส
        </h1>
        <p className="muted stock-subtitle">
          {showCatalog
            ? "จัดการสินค้า + เรทเริ่มต้น (เจ้าของ)"
            : "บันทึกยอดผลิตประจำวัน"}
        </p>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {isPermPreview && showLog ? (
        <p className="muted" style={{ margin: "0 0 0.55rem", fontSize: "0.78rem" }}>
          พรีวิวมุมพนักงาน — เลือกเดือนดูรายการของคนนี้ได้ · กรอก/แก้ไม่ได้
        </p>
      ) : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && showCatalog ? (
        <>
          {ownerTabs ? (
            <div className="ot-toolbar-slim module-toolbar-slim">{ownerTabs}</div>
          ) : null}
          <ProdCatalogSetup
            products={products}
            shopSalesRate={
              resolveRateForDate(rateSchedule, "bakerySales", Date.now())?.rate ??
              undefined
            }
            onReload={() => void reloadCatalog().catch((err) => setError((err as Error).message))}
            onError={setError}
          />
        </>
      ) : null}

      {!loading && showLog ? (
        <ProdTable
          entries={entries}
          workers={workers}
          isOwner={isOwner}
          mineOnly={!shopProdView}
          canOpenRow={canWrite}
          month={logMonth}
          onMonthChange={setLogMonth}
          onEdit={openEdit}
          onError={setError}
          toolbarLeading={ownerTabs}
        />
      ) : null}

      {canWrite && formOpen && !loading && showLog ? (
        <div className="modal-backdrop edit-modal is-module-form" onClick={closeForm}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <ProdEntryForm
              key={editing?.id || "new"}
              entry={editing}
              products={activeProducts}
              workers={activeWorkers}
              rateSchedule={rateSchedule}
              createdBy={actorId}
              isOwner={isOwner}
              onError={setError}
              onSaved={closeForm}
              onCancelEdit={closeForm}
              onOpenCatalog={
                isOwner
                  ? () => {
                      setOwnerView("catalog");
                      setFormOpen(false);
                    }
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}

      {canWrite && showLog ? (
        <ModuleTabDock
          ariaLabel="มุมมองผลิต"
          formOpen={formOpen}
          onAdd={openAdd}
        />
      ) : null}
      {/* พรีวิว: โชว์ปุ่ม + กรอกแบบพนักงาน แต่กดไม่ได้ — ให้สภาพแวดล้อมใกล้ของจริง */}
      {isPermPreview && showLog ? (
        <div className="module-tab-dock is-single" role="tablist" aria-label="มุมมองผลิต">
          <button
            type="button"
            role="tab"
            className="module-tab is-add"
            disabled
            title="พรีวิว — กรอกไม่ได้"
            aria-disabled="true"
          >
            + กรอก
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProdEntryForm({
  entry,
  products,
  workers,
  rateSchedule,
  createdBy,
  isOwner,
  onError,
  onSaved,
  onCancelEdit,
  onOpenCatalog,
}: {
  entry: ProdEntry | null;
  products: ProdProduct[];
  workers: ProdWorker[];
  rateSchedule: RateScheduleEntry[];
  createdBy: string;
  isOwner: boolean;
  onError: (msg: string) => void;
  onSaved: () => void;
  onCancelEdit: () => void;
  onOpenCatalog?: () => void;
}) {
  const locked = entry ? isProdEntryLocked(entry) : false;
  const [date, setDate] = useState(entry ? todayInputValue(new Date(entry.date)) : todayInputValue());
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>(
    entry?.workerIds?.length ? entry.workerIds : [],
  );
  const [productId, setProductId] = useState(entry?.productId || products[0]?.id || "");
  const [qty, setQty] = useState(entry ? String(entry.qtyProduced) : "");
  const [waste, setWaste] = useState(entry ? String(entry.qtyWaste || 0) : "");
  const [note, setNote] = useState(entry?.note || "");
  const [imageUrls, setImageUrls] = useState<string[]>(() => getProdImageUrls(entry));
  const [busy, setBusy] = useState(false);

  const product = products.find((p) => p.id === productId) || null;
  const dateMs = parseDateInput(date);
  const rates = resolveProdEntryRates(entry, productId, product, {
    bakerySalesSchedule: rateSchedule,
    dateMs,
  });

  const preview = useMemo(() => {
    const names = workers.filter((w) => selectedWorkers.includes(w.id)).map((w) => w.name);
    return computeProdBonus({
      qtyProduced: Number(qty) || 0,
      salesRate: 0,
      prodRate: rates.prodRate,
      workerNames: names.length ? names : entry?.workerNames || [],
    });
  }, [qty, rates.prodRate, selectedWorkers, workers, entry]);

  function toggleWorker(id: string) {
    if (locked) return;
    setSelectedWorkers((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    if (!createdBy) return;
    const chosen = workers.filter((w) => selectedWorkers.includes(w.id));
    if (!chosen.length) {
      onError("เลือกพนักงานอย่างน้อย 1 คน");
      return;
    }
    const prod = products.find((p) => p.id === productId);
    if (!prod && !entry) {
      onError("เลือกสินค้า");
      return;
    }
    setBusy(true);
    try {
      const urls = imageUrls.filter(Boolean).slice(0, PROD_IMAGE_MAX);
      if (urls.some((u) => u.startsWith("data:"))) {
        onError("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่เพื่อบันทึกเข้าคลังหลักฐาน");
        setBusy(false);
        return;
      }
      const entryDateMs = parseDateInput(date);
      const resolved = resolveProdEntryRates(entry, productId, prod ?? null, {
        bakerySalesSchedule: rateSchedule,
        dateMs: entryDateMs,
      });
      const payload = {
        date: entryDateMs,
        workerIds: chosen.map((w) => w.id),
        workerNames: chosen.map((w) => w.name),
        productId: prod?.id || entry!.productId,
        productName: prod?.name || entry!.productName,
        // โบนัสขายคิดที่หน้าสรุปโบนัสจากจำนวน × ตารางเรท — ไม่ติดเรทขายที่แถวผลิต
        salesRate: 0,
        prodRate: resolved.prodRate,
        qtyProduced: Number(qty),
        qtyWaste: Number(waste) || 0,
        note,
        imageUrls: urls,
        imageUrl: urls[0] || "",
      };
      if (entry) {
        await updateProdEntry(entry.id, payload);
      } else {
        await addProdEntry({ ...payload, createdBy });
      }
      onSaved();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card entry-form module-entry-form" onSubmit={(e) => void onSubmit(e)}>
      <div className="entry-toolbar module-form-head">
        <h2 className="panel-title">{entry ? (locked ? "ดูรายการ (จ่ายแล้ว)" : "แก้ไขรายการ") : "บันทึกผลิต"}</h2>
        <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onCancelEdit}>
          <X size={18} />
        </button>
      </div>
      {entry ? (
        <EntryTimestampsMeta
          entryDate={entry.date}
          createdAt={entry.createdAt}
          updatedAt={entry.updatedAt}
          era="be"
        />
      ) : null}

      {locked ? (
        <p className="muted form-hint-inline prod-locked-hint">
          <Lock size={14} aria-hidden /> จ่ายโบนัสแล้ว — เรทและยอดล็อก · เปลี่ยนสถานะได้ที่ตาราง
        </p>
      ) : null}

      {!products.length || !workers.length ? (
        <p className="muted form-hint-inline">
          ยังไม่มีสินค้าหรือรายชื่อพนักงาน —{" "}
          {isOwner && onOpenCatalog && !products.length ? (
            <button type="button" className="linkish-btn" onClick={onOpenCatalog}>
              ไปเพิ่มที่แท็บสินค้า / เรท
            </button>
          ) : (
            "รอเจ้าของตั้งค่าที่หน้าผลิต → สินค้า / เรท · พนักงานอยู่ศูนย์รวมพนักงาน"
          )}
        </p>
      ) : null}

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="prod-date">วันที่</label>
          <input id="prod-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={locked} />
        </div>
        <div className="field">
          <label htmlFor="prod-product">สินค้า</label>
          <select
            id="prod-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            required
            disabled={locked}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {entry && !locked && productId !== entry.productId ? (
        <p className="muted check-hint">เปลี่ยนสินค้า → ใช้เรทปัจจุบันของสินค้าใหม่</p>
      ) : null}

      <div className="field">
        <span className="field-label">พนักงาน (สูงสุด 2)</span>
        <div className="suggest-list">
          {workers.map((w) => {
            const on = selectedWorkers.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                className={on ? "suggest-chip is-active" : "suggest-chip"}
                onClick={() => toggleWorker(w.id)}
                disabled={locked}
              >
                {w.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="prod-qty">ผลิต</label>
          <input
            id="prod-qty"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
            disabled={locked}
          />
        </div>
        <div className="field">
          <label htmlFor="prod-waste">ทิ้ง/เสีย</label>
          <input
            id="prod-waste"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={waste}
            onChange={(e) => setWaste(e.target.value)}
            placeholder="0"
            disabled={locked}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="prod-note">หมายเหตุ</label>
        <input
          id="prod-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
          disabled={locked}
        />
      </div>

      {imageUrls.length || !locked ? (
        <PhotoAttachMultiField
          values={imageUrls}
          onChange={setImageUrls}
          onError={onError}
          label="ถ่ายรูป"
          max={PROD_IMAGE_MAX}
          storageFolder="production"
          storageSlotKey={entry?.id || "new"}
          hint="ถ่ายสดจากกล้องเท่านั้น — ห้ามแนบจากแกลเลอรี"
          allowCamera
          allowGallery={false}
          requireLiveCapture
          readOnly={locked}
        />
      ) : null}

      {locked ? (
        <p className="muted form-hint-inline">
          เรทผลิต {formatPlainNumber(entry!.prodRate)} · โบนัสผลิต/คน{" "}
          {formatPlainNumber(preview.bonusPerPerson)} บาท
        </p>
      ) : Number(qty) > 0 && selectedWorkers.length > 0 ? (
        <p className="muted form-hint-inline">
          โบนัสผลิต/คน ≈ {formatPlainNumber(preview.bonusPerPerson)} บาท
          {entry ? ` · เรทผลิต ${formatPlainNumber(rates.prodRate)} (ติดกับแถวนี้)` : ""}
        </p>
      ) : null}

      <div className="entry-actions module-form-actions">
        {!locked ? (
          <button type="submit" className="primary-btn action-out" disabled={busy || !products.length}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        ) : null}
        <button type="button" className="ghost-btn" disabled={busy} onClick={onCancelEdit}>
          {locked ? "ปิด" : "ออก"}
        </button>
      </div>
    </form>
  );
}

function ProdTable({
  entries,
  workers,
  isOwner,
  mineOnly,
  canOpenRow,
  month,
  onMonthChange,
  onEdit,
  onError,
  toolbarLeading,
}: {
  entries: ProdEntry[];
  workers: ProdWorker[];
  isOwner: boolean;
  /** true = มุมพนักงาน (รายการของฉัน) — ซ่อนคอลัมน์พนักงาน */
  mineOnly: boolean;
  /** false = พรีวิว/อ่านอย่างเดียว — ไม่เปิดฟอร์มแก้ */
  canOpenRow: boolean;
  month: string;
  onMonthChange: (month: string) => void;
  onEdit: (row: ProdEntry) => void;
  onError: (msg: string | null) => void;
  toolbarLeading?: ReactNode;
}) {
  const [preview, setPreview] = useState<{
    urls: string[];
    title: string;
    entryDateMs?: number;
  } | null>(null);
  const [photoReport, setPhotoReport] = useState<PhotoForensicsReport | null>(null);

  useBodyScrollLock(!!preview);

  // entries ถูก scope ตามเดือน (+ workerId มุมพนักงาน) จาก parent แล้ว
  const filtered = entries;

  const forensicsRows = useMemo(
    () =>
      entries.map((row) => ({
        entryId: row.id,
        entryDate: row.date,
        label: `${formatDateShortBe(row.date)} ${row.productName}`,
        imageUrls: getProdImageUrls(row),
      })),
    [entries],
  );

  useEffect(() => {
    setPhotoReport(null);
  }, [month, entries.length]);

  async function onDelete(row: ProdEntry) {
    if (!window.confirm("ลบรายการนี้?")) return;
    try {
      await deleteProdEntry(row.id);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  return (
    <>
      <div className="ot-toolbar-slim module-toolbar-slim">
        {toolbarLeading}
        <input
          type="month"
          className="ot-slim-input"
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          aria-label="เดือนอ้างอิง"
        />
        <span
          className="ot-slim-hint muted module-slim-hint"
          title="สถานะล็อกเมื่อปิดเดือนโบนัสที่ จ่าย/โบนัส — ไม่เปลี่ยนสถานะเป็นกลุ่มที่นี่"
        >
          {mineOnly ? "รายการของฉันในเดือนนี้" : "ล็อกเมื่อปิดเดือนโบนัส"}
        </span>
        {isOwner ? (
          <PhotoForensicsPanel
            rows={forensicsRows}
            onReport={setPhotoReport}
            onPickEntry={(id) => {
              const row = filtered.find((r) => r.id === id);
              if (row && canOpenRow) onEdit(row);
            }}
          />
        ) : null}
      </div>

      {!entries.length ? (
        <p className="empty">
          {mineOnly
            ? "ยังไม่มีรายการผลิตของคุณในเดือนนี้"
            : "ยังไม่มีรายการผลิตในเดือนนี้ — กด + กรอก ด้านล่างเพื่อเริ่ม"}
        </p>
      ) : (
        <div className="sheet-wrap production-sheet sheet-bleed">
          <table className="sheet-table prod-table sheet-table--dense">
            <thead>
              <tr>
                <th className="col-date">วันที่</th>
                {mineOnly ? null : (
                  <th className="col-desc prod-col-worker">พนักงาน</th>
                )}
                <th className="col-desc prod-col-product col-sticky-left">สินค้า</th>
                <th className="col-out">ผลิต</th>
                <th className="col-out">ทิ้ง/เสีย</th>
                <th className="col-note">หมายเหตุ</th>
                {isOwner ? (
                  <>
                    <th className="col-out">เรทผลิต</th>
                    <th className="col-out">โบนัสผลิต</th>
                    <th className="col-act">คน</th>
                  </>
                ) : null}
                <th className="col-out">โบนัส/คน</th>
                <th className="col-act">สถานะ</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const c = computeProdBonus(row);
                const locked = isProdEntryLocked(row);
                const photoFlagged = isOwner && entryHasPhotoFlag(photoReport, row.id);
                const flagHints = photoReport?.byEntryId[row.id]?.hints || [];
                return (
                  <tr
                    key={row.id}
                    className={[
                      locked ? "row-out prod-row-paid" : "row-out",
                      photoFlagged ? "is-photo-flag" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className="col-date">{formatDateShortBe(row.date)}</td>
                    {mineOnly ? null : (
                      <td className="col-desc prod-col-worker">
                        {resolveWorkerDisplayNames(row.workerIds, row.workerNames, workers).join(
                          ", ",
                        ) || "—"}
                      </td>
                    )}
                    <td className="col-desc prod-col-product col-sticky-left">
                      <div className="prod-name-row">
                        <button
                          type="button"
                          className="desc-link"
                          title={
                            canOpenRow
                              ? row.productName
                              : `${row.productName} · ดูอย่างเดียว`
                          }
                          onClick={() => {
                            if (canOpenRow) onEdit(row);
                          }}
                          disabled={!canOpenRow}
                        >
                          {locked ? <Lock size={11} aria-hidden /> : null} {row.productName}
                        </button>
                        <EntryPhotoIndicator
                          imageUrl={row.imageUrl}
                          imageUrls={row.imageUrls}
                          label={row.productName}
                          flagged={photoFlagged}
                          flagTitle={flagHints.join(" · ") || undefined}
                          onView={(urls) =>
                            setPreview({ urls, title: row.productName, entryDateMs: row.date })
                          }
                        />
                      </div>
                    </td>
                    <td className="col-out">{formatPlainNumber(row.qtyProduced)}</td>
                    <td className="col-out">{row.qtyWaste ? formatPlainNumber(row.qtyWaste) : "—"}</td>
                    <td className="col-note" title={row.note || ""}>{row.note || ""}</td>
                    {isOwner ? (
                      <>
                        <td className="col-out">{formatPlainNumber(row.prodRate)}</td>
                        <td className="col-out">{formatPlainNumber(c.prodBonus)}</td>
                        <td className="col-act">{c.workerCount}</td>
                      </>
                    ) : null}
                    <td className="col-out">{formatPlainNumber(c.bonusPerPerson)}</td>
                    <td className="col-act">
                      <span
                        className={
                          row.status === "paid" ? "prod-status-pill is-paid" : "prod-status-pill"
                        }
                      >
                        {labelProdStatus(row.status)}
                      </span>
                    </td>
                    <td className="col-act">
                      {isOwner && !locked ? (
                        <button
                          type="button"
                          className="trash-btn"
                          aria-label="ลบ"
                          onClick={() => void onDelete(row)}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {preview ? (
        <ImagePreviewModal
          urls={preview.urls}
          title={preview.title}
          entryDateMs={preview.entryDateMs}
          showCaptureMeta={isOwner}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}
