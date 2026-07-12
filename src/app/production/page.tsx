"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Lock, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { BulkStatusToolbar } from "@/components/BulkStatusToolbar";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachField } from "@/components/PhotoAttachField";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useAuth } from "@/lib/auth";
import { isInMonth, monthInputValue, parseMonthInput } from "@/lib/bonus";
import { can } from "@/lib/permissions";
import {
  addProdEntry,
  bulkUpdateProdEntryStatus,
  computeProdBonus,
  deleteProdEntry,
  isProdEntryLocked,
  labelProdStatus,
  normalizeProdStatus,
  listProdProducts,
  listProdWorkers,
  resolveProdEntryRates,
  seedProdCatalogIfEmpty,
  subscribeProdEntries,
  updateProdEntry,
  type ProdEntry,
  type ProdProduct,
  type ProdStatus,
  type ProdWorker,
} from "@/lib/production";
import {
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

export default function ProductionPage() {
  return (
    <AuthGate>
      <ProductionView />
    </AuthGate>
  );
}

function ProductionView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [formOpen, setFormOpen] = useState(false);
  const [entries, setEntries] = useState<ProdEntry[]>([]);
  const [products, setProducts] = useState<ProdProduct[]>([]);
  const [workers, setWorkers] = useState<ProdWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProdEntry | null>(null);

  async function reloadCatalog() {
    const [p, w] = await Promise.all([listProdProducts(), listProdWorkers()]);
    setProducts(p);
    setWorkers(w);
  }

  useEffect(() => {
    if (staff && !can(staff, "production")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "production")) return;
    setLoading(true);
    void reloadCatalog()
      .then(async () => {
        if (isOwner) {
          const seeded = await seedProdCatalogIfEmpty();
          if (seeded.products || seeded.workers) await reloadCatalog();
        }
      })
      .catch((err) => setError((err as Error).message || "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));

    const unsub = subscribeProdEntries(
      (rows) => setEntries(rows),
      (err) => setError(err.message || "โหลดรายการไม่สำเร็จ"),
    );
    return unsub;
  }, [staff, isOwner]);

  useBodyScrollLock(formOpen);

  if (!can(staff, "production")) return null;

  const activeProducts = products.filter((p) => p.active);
  const activeWorkers = workers.filter((w) => w.active);

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

  return (
    <div className="module-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <ChefHat size={18} aria-hidden />
          ผลิต / โบนัส
        </h1>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <ProdTable
          entries={entries}
          isOwner={isOwner}
          onEdit={openEdit}
          onError={setError}
        />
      ) : null}

      {formOpen && !loading ? (
        <div className="modal-backdrop edit-modal is-module-form" onClick={closeForm}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <ProdEntryForm
              key={editing?.id || "new"}
              entry={editing}
              products={activeProducts}
              workers={activeWorkers}
              createdBy={actorId}
              onError={setError}
              onSaved={closeForm}
              onCancelEdit={closeForm}
            />
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        ariaLabel="มุมมองผลิต"
        formOpen={formOpen}
        onAdd={openAdd}
      />
    </div>
  );
}

function ProdEntryForm({
  entry,
  products,
  workers,
  createdBy,
  onError,
  onSaved,
  onCancelEdit,
}: {
  entry: ProdEntry | null;
  products: ProdProduct[];
  workers: ProdWorker[];
  createdBy: string;
  onError: (msg: string) => void;
  onSaved: () => void;
  onCancelEdit: () => void;
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
  const [imageUrl, setImageUrl] = useState(entry?.imageUrl || "");
  const [busy, setBusy] = useState(false);

  const product = products.find((p) => p.id === productId) || null;
  const rates = resolveProdEntryRates(entry, productId, product);

  const preview = useMemo(() => {
    const names = workers.filter((w) => selectedWorkers.includes(w.id)).map((w) => w.name);
    return computeProdBonus({
      qtyProduced: Number(qty) || 0,
      salesRate: rates.salesRate,
      prodRate: rates.prodRate,
      workerNames: names.length ? names : entry?.workerNames || [],
    });
  }, [qty, rates, selectedWorkers, workers, entry]);

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
      const resolved = resolveProdEntryRates(entry, productId, prod ?? null);
      const payload = {
        date: parseDateInput(date),
        workerIds: chosen.map((w) => w.id),
        workerNames: chosen.map((w) => w.name),
        productId: prod?.id || entry!.productId,
        productName: prod?.name || entry!.productName,
        salesRate: resolved.salesRate,
        prodRate: resolved.prodRate,
        qtyProduced: Number(qty),
        qtyWaste: Number(waste) || 0,
        note,
        imageUrl,
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

      {locked ? (
        <p className="muted form-hint-inline prod-locked-hint">
          <Lock size={14} aria-hidden /> จ่ายโบนัสแล้ว — เรทและยอดล็อก · เปลี่ยนสถานะได้ที่ตาราง
        </p>
      ) : null}

      {!products.length || !workers.length ? (
        <p className="muted form-hint-inline">
          ยังไม่มีสินค้าหรือรายชื่อพนักงาน — เจ้าของตั้งค่าที่{" "}
          <a href="/settings/" style={{ fontWeight: 700 }}>ตั้งค่าโมดูล</a>
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

      {!locked ? (
        <PhotoAttachField value={imageUrl} onChange={setImageUrl} onError={onError} label="แนบรูป" />
      ) : null}

      {locked ? (
        <p className="muted form-hint-inline">
          เรทขาย {formatPlainNumber(entry!.salesRate)} · เรทผลิต {formatPlainNumber(entry!.prodRate)} · โบนัส/คน{" "}
          {formatPlainNumber(preview.bonusPerPerson)} บาท
        </p>
      ) : Number(qty) > 0 && selectedWorkers.length > 0 ? (
        <p className="muted form-hint-inline">
          โบนัส/คน ≈ {formatPlainNumber(preview.bonusPerPerson)} บาท
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
  isOwner,
  onEdit,
  onError,
}: {
  entries: ProdEntry[];
  isOwner: boolean;
  onEdit: (row: ProdEntry) => void;
  onError: (msg: string | null) => void;
}) {
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [month, setMonth] = useState(monthInputValue());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useBodyScrollLock(!!preview);

  const { year, month: monthIdx } = parseMonthInput(month);
  const filtered = useMemo(
    () => (isOwner ? entries.filter((row) => isInMonth(row.date, year, monthIdx)) : entries),
    [entries, isOwner, year, monthIdx],
  );

  const unpaidIds = useMemo(
    () => filtered.filter((r) => normalizeProdStatus(r.status) === "unpaid").map((r) => r.id),
    [filtered],
  );

  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleIds));
    }
  }

  async function setStatus(row: ProdEntry, status: ProdStatus) {
    try {
      await updateProdEntry(row.id, { status });
    } catch (err) {
      onError((err as Error).message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  async function onBulkStatus(status: ProdStatus) {
    const ids = [...selected];
    if (!ids.length) return;
    const label = labelProdStatus(status);
    if (!window.confirm(`เปลี่ยนสถานะ ${ids.length} รายการเป็น "${label}"?`)) return;
    setBulkBusy(true);
    onError(null);
    try {
      await bulkUpdateProdEntryStatus(ids, status);
      setSelected(new Set());
    } catch (err) {
      onError((err as Error).message || "อัปเดตกลุ่มไม่สำเร็จ");
    } finally {
      setBulkBusy(false);
    }
  }

  async function onDelete(row: ProdEntry) {
    if (!window.confirm("ลบรายการนี้?")) return;
    try {
      await deleteProdEntry(row.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  if (!entries.length) {
    return <p className="empty">ยังไม่มีรายการผลิต — กด + กรอก ด้านล่างเพื่อเริ่ม</p>;
  }

  return (
    <>
      {isOwner ? (
        <BulkStatusToolbar
          variant="prod"
          selectedCount={selected.size}
          month={month}
          onMonthChange={(v) => {
            setMonth(v);
            setSelected(new Set());
          }}
          onSelectUnpaid={() => setSelected(new Set(unpaidIds))}
          onSelectVisible={() => setSelected(new Set(visibleIds))}
          onClear={() => setSelected(new Set())}
          onSetStatus={(s) => void onBulkStatus(s as ProdStatus)}
          busy={bulkBusy}
          visibleCount={visibleIds.length}
          unpaidCount={unpaidIds.length}
        />
      ) : null}

      {!filtered.length && isOwner ? (
        <p className="empty">ไม่มีรายการในเดือนนี้</p>
      ) : (
        <div className="sheet-wrap">
          <table className="sheet-table prod-table">
            <thead>
              <tr>
                {isOwner ? (
                  <th className="col-act bulk-check-col">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected && !allVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                      aria-label="เลือกทั้งหมดที่แสดง"
                    />
                  </th>
                ) : null}
                <th className="col-date">วันที่</th>
                <th className="col-desc prod-col-worker">พนักงาน</th>
                <th className="col-desc prod-col-product col-sticky-left">สินค้า</th>
                <th className="col-out">ผลิต</th>
                <th className="col-out">ทิ้ง/เสีย</th>
                <th className="col-note">หมายเหตุ</th>
                {isOwner ? (
                  <>
                    <th className="col-out">เรทขาย</th>
                    <th className="col-out">โบนัสขาย</th>
                    <th className="col-out">เรทผลิต</th>
                    <th className="col-out">โบนัสรวม</th>
                    <th className="col-act">คน</th>
                  </>
                ) : null}
                <th className="col-out">โบนัส/คน</th>
                <th className="col-act">สถานะ</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>
              {(isOwner ? filtered : entries).map((row) => {
                const c = computeProdBonus(row);
                const locked = isProdEntryLocked(row);
                return (
                  <tr key={row.id} className={locked ? "row-out prod-row-paid" : "row-out"}>
                    {isOwner ? (
                      <td className="col-act bulk-check-col">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`เลือก ${row.productName}`}
                        />
                      </td>
                    ) : null}
                    <td className="col-date">{formatDateShort(row.date)}</td>
                    <td className="col-desc prod-col-worker">{row.workerNames.join(", ")}</td>
                    <td className="col-desc prod-col-product col-sticky-left">
                      <div className="prod-name-row">
                        <button
                          type="button"
                          className="desc-link"
                          title={row.productName}
                          onClick={() => onEdit(row)}
                        >
                          {locked ? <Lock size={11} aria-hidden /> : null} {row.productName}
                        </button>
                        <EntryPhotoIndicator
                          imageUrl={row.imageUrl}
                          label={row.productName}
                          onView={(url) => setPreview({ url, title: row.productName })}
                        />
                      </div>
                    </td>
                    <td className="col-out">{formatPlainNumber(row.qtyProduced)}</td>
                    <td className="col-out">{row.qtyWaste ? formatPlainNumber(row.qtyWaste) : "—"}</td>
                    <td className="col-note" title={row.note || ""}>{row.note || ""}</td>
                    {isOwner ? (
                      <>
                        <td className="col-out">{formatPlainNumber(row.salesRate)}</td>
                        <td className="col-out">{formatPlainNumber(c.salesBonus)}</td>
                        <td className="col-out">{formatPlainNumber(row.prodRate)}</td>
                        <td className="col-out">{formatPlainNumber(c.prodBonus)}</td>
                        <td className="col-act">{c.workerCount}</td>
                      </>
                    ) : null}
                    <td className="col-out">{formatPlainNumber(c.bonusPerPerson)}</td>
                    <td className="col-act">
                      {isOwner ? (
                        <select
                          className={row.status === "paid" ? "prod-status is-paid" : "prod-status"}
                          value={row.status === "paid" ? "paid" : "unpaid"}
                          onChange={(e) => void setStatus(row, e.target.value as ProdStatus)}
                          aria-label="สถานะโบนัส"
                        >
                          <option value="unpaid">รอจ่าย</option>
                          <option value="paid">จ่ายแล้ว</option>
                        </select>
                      ) : (
                        <span
                          className={
                            row.status === "paid" ? "prod-status-pill is-paid" : "prod-status-pill"
                          }
                        >
                          {labelProdStatus(row.status)}
                        </span>
                      )}
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
        <ImagePreviewModal url={preview.url} title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </>
  );
}
