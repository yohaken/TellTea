"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { EntryPhotoCell, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachField } from "@/components/PhotoAttachField";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  addProdEntry,
  addProdProduct,
  computeProdBonus,
  deleteProdEntry,
  labelProdStatus,
  listProdProducts,
  listProdWorkers,
  seedProdCatalogIfEmpty,
  subscribeProdEntries,
  updateProdEntry,
  updateProdProduct,
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
  const { user, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [setupOpen, setSetupOpen] = useState(false);
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

  useEffect(() => {
    if (setupOpen && !isOwner) setSetupOpen(false);
  }, [setupOpen, isOwner]);

  if (!can(staff, "production")) return null;

  const activeProducts = products.filter((p) => p.active);
  const activeWorkers = workers.filter((w) => w.active);

  function openAdd() {
    setEditing(null);
    setSetupOpen(false);
    setFormOpen(true);
  }

  function openSetup() {
    if (setupOpen) {
      setSetupOpen(false);
      return;
    }
    setFormOpen(false);
    setEditing(null);
    setSetupOpen(true);
  }

  function openEdit(row: ProdEntry) {
    setSetupOpen(false);
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

      {!loading && !setupOpen ? (
        <ProdTable
          entries={entries}
          isOwner={isOwner}
          onEdit={openEdit}
          onError={setError}
        />
      ) : null}

      {!loading && setupOpen && isOwner ? (
        <ProdSetup
          products={products}
          onReload={() => void reloadCatalog().catch((err) => setError((err as Error).message))}
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
              createdBy={user?.email || ""}
              onError={setError}
              onSaved={closeForm}
              onCancelEdit={closeForm}
            />
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        setupActive={setupOpen}
        isOwner={isOwner}
        ariaLabel="มุมมองผลิต"
        formOpen={formOpen}
        onAdd={openAdd}
        onSetup={openSetup}
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
  const preview = useMemo(() => {
    const names = workers.filter((w) => selectedWorkers.includes(w.id)).map((w) => w.name);
    return computeProdBonus({
      qtyProduced: Number(qty) || 0,
      salesRate: product?.salesRate || entry?.salesRate || 0,
      prodRate: product?.prodRate || entry?.prodRate || 0,
      workerNames: names.length ? names : entry?.workerNames || [],
    });
  }, [qty, product, selectedWorkers, workers, entry]);

  function toggleWorker(id: string) {
    setSelectedWorkers((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
      const payload = {
        date: parseDateInput(date),
        workerIds: chosen.map((w) => w.id),
        workerNames: chosen.map((w) => w.name),
        productId: prod?.id || entry!.productId,
        productName: prod?.name || entry!.productName,
        salesRate: prod?.salesRate ?? entry!.salesRate,
        prodRate: prod?.prodRate ?? entry!.prodRate,
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
        <h2 className="panel-title">{entry ? "แก้ไขรายการ" : "บันทึกผลิต"}</h2>
        <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onCancelEdit}>
          <X size={18} />
        </button>
      </div>

      {!products.length || !workers.length ? (
        <p className="muted form-hint-inline">
          ยังไม่มีสินค้าหรือรายชื่อพนักงาน — ให้เจ้าของไปตั้งค่าก่อน
        </p>
      ) : null}

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="prod-date">วันที่</label>
          <input id="prod-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="prod-product">สินค้า</label>
          <select
            id="prod-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            required
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

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
        />
      </div>

      <PhotoAttachField value={imageUrl} onChange={setImageUrl} onError={onError} label="แนบรูป" />

      {Number(qty) > 0 && selectedWorkers.length > 0 ? (
        <p className="muted form-hint-inline">
          โบนัส/คน ≈ {formatPlainNumber(preview.bonusPerPerson)} บาท
        </p>
      ) : null}

      <div className="entry-actions module-form-actions">
        <button type="submit" className="primary-btn action-out" disabled={busy || !products.length}>
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={onCancelEdit}>
          ออก
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
  onError: (msg: string) => void;
}) {
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  async function setStatus(row: ProdEntry, status: ProdStatus) {
    try {
      await updateProdEntry(row.id, { status });
    } catch (err) {
      onError((err as Error).message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  async function onDelete(row: ProdEntry) {
    if (!window.confirm("ลบรายการนี้?")) return;
    try {
      await deleteProdEntry(row.id);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  if (!entries.length) {
    return <p className="empty">ยังไม่มีรายการผลิต — กด + กรอก ด้านล่างเพื่อเริ่ม</p>;
  }

  return (
    <>
    <div className="sheet-wrap">
      <table className="sheet-table prod-table">
        <thead>
          <tr>
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
          {entries.map((row) => {
            const c = computeProdBonus(row);
            return (
              <tr key={row.id} className="row-out">
                <td className="col-date">{formatDateShort(row.date)}</td>
                <td className="col-desc prod-col-worker">{row.workerNames.join(", ")}</td>
                <td className="col-desc prod-col-product col-sticky-left">
                  <div className="desc-with-photo">
                    <button
                      type="button"
                      className="desc-link"
                      title={row.productName}
                      onClick={() => onEdit(row)}
                    >
                      {row.productName}
                    </button>
                    <EntryPhotoCell
                      imageUrl={row.imageUrl}
                      label={row.productName}
                      onView={(url) => setPreview({ url, title: row.productName })}
                      onAdd={() => onEdit(row)}
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
                      className={
                        row.status === "paid"
                          ? "prod-status is-paid"
                          : row.status === "pending"
                            ? "prod-status is-pending"
                            : "prod-status"
                      }
                      value={row.status}
                      onChange={(e) => void setStatus(row, e.target.value as ProdStatus)}
                      aria-label="สถานะโบนัส"
                    >
                      <option value="unpaid">ยังไม่จ่าย</option>
                      <option value="pending">เตรียมจ่ายโบนัส</option>
                      <option value="paid">จ่ายโบนัสแล้ว</option>
                    </select>
                  ) : (
                    <span
                      className={
                        row.status === "paid"
                          ? "prod-status-pill is-paid"
                          : row.status === "pending"
                            ? "prod-status-pill is-pending"
                            : "prod-status-pill"
                      }
                    >
                      {labelProdStatus(row.status)}
                    </span>
                  )}
                </td>
                <td className="col-act">
                  {isOwner ? (
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
    {preview ? (
      <ImagePreviewModal url={preview.url} title={preview.title} onClose={() => setPreview(null)} />
    ) : null}
    </>
  );
}

function ProdSetup({
  products,
  onReload,
  onError,
}: {
  products: ProdProduct[];
  onReload: () => void;
  onError: (msg: string) => void;
}) {
  const [pName, setPName] = useState("");
  const [salesRate, setSalesRate] = useState("0.60");
  const [prodRate, setProdRate] = useState("1.25");
  const [busy, setBusy] = useState(false);

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addProdProduct({
        name: pName,
        salesRate: Number(salesRate),
        prodRate: Number(prodRate),
      });
      setPName("");
      onReload();
    } catch (err) {
      onError((err as Error).message || "เพิ่มสินค้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prod-setup">
      <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
        เรทขาย / เรทผลิต เป็นค่าตายตัวต่อสินค้า · โบนัส/คน = ผลิต × เรทผลิต ÷ จำนวนคน
      </p>
      <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
        รายชื่อพนักงานอยู่ที่{" "}
        <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
        {" "}— เพิ่มที่เดียว แล้วมาเลือกตอนกรอกผลิต
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void addProduct(e)}>
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>สินค้า + เรท</h2>
        <div className="field">
          <label htmlFor="setup-pname">ชื่อสินค้า</label>
          <input id="setup-pname" value={pName} onChange={(e) => setPName(e.target.value)} required />
        </div>
        <div className="stock-form-grid">
          <div className="field">
            <label htmlFor="setup-sales">เรทขาย</label>
            <input id="setup-sales" type="number" step="0.01" min="0" value={salesRate} onChange={(e) => setSalesRate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="setup-prod">เรทผลิต</label>
            <input id="setup-prod" type="number" step="0.01" min="0" value={prodRate} onChange={(e) => setProdRate(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>เพิ่มสินค้า</button>
      </form>

      <div className="list-card" style={{ marginTop: "0.75rem" }}>
        {products.map((p) => (
          <div key={p.id} className="list-row" style={{ flexWrap: "wrap", gap: "0.45rem" }}>
            <div style={{ flex: 1, minWidth: "8rem" }}>
              <strong>{p.name}</strong>
              <div className="muted" style={{ fontSize: "0.78rem" }}>
                ขาย {formatPlainNumber(p.salesRate)} · ผลิต {formatPlainNumber(p.prodRate)}
                {!p.active ? " · ปิดใช้" : ""}
              </div>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                void updateProdProduct(p.id, { active: !p.active })
                  .then(onReload)
                  .catch((err) => onError(err.message || "อัปเดตไม่สำเร็จ"))
              }
            >
              {p.active ? "ปิด" : "เปิด"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
