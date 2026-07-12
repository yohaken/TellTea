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
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  addProdEntry,
  addProdProduct,
  addProdWorker,
  computeProdBonus,
  deleteProdEntry,
  labelProdStatus,
  listProdProducts,
  listProdWorkers,
  seedProdCatalogIfEmpty,
  subscribeProdEntries,
  updateProdEntry,
  updateProdProduct,
  updateProdWorker,
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

type Tab = "form" | "table" | "setup";

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
  const [tab, setTab] = useState<Tab>("form");
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

  if (!can(staff, "production")) return null;

  const activeProducts = products.filter((p) => p.active);
  const activeWorkers = workers.filter((w) => w.active);

  return (
    <div>
      <div className="entry-toolbar" style={{ position: "static", paddingTop: 0 }}>
        <h1 className="panel-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <ChefHat size={20} aria-hidden />
          ผลิต / โบนัส
        </h1>
      </div>

      <div className="prod-tabs" role="tablist" aria-label="มุมมองผลิต">
        <button
          type="button"
          role="tab"
          className={tab === "form" ? "prod-tab is-active" : "prod-tab"}
          aria-selected={tab === "form"}
          onClick={() => { setTab("form"); setEditing(null); }}
        >
          กรอก
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "table" ? "prod-tab is-active" : "prod-tab"}
          aria-selected={tab === "table"}
          onClick={() => setTab("table")}
        >
          ตาราง
        </button>
        {isOwner ? (
          <button
            type="button"
            role="tab"
            className={tab === "setup" ? "prod-tab is-active" : "prod-tab"}
            aria-selected={tab === "setup"}
            onClick={() => setTab("setup")}
          >
            ตั้งค่า
          </button>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && tab === "form" ? (
        <ProdEntryForm
          key={editing?.id || "new"}
          entry={editing}
          products={activeProducts}
          workers={activeWorkers}
          createdBy={user?.email || ""}
          onError={setError}
          onSaved={() => {
            setEditing(null);
            setTab("table");
          }}
          onCancelEdit={() => setEditing(null)}
        />
      ) : null}

      {!loading && tab === "table" ? (
        <ProdTable
          entries={entries}
          isOwner={isOwner}
          onEdit={(row) => {
            setEditing(row);
            setTab("form");
          }}
          onError={setError}
        />
      ) : null}

      {!loading && tab === "setup" && isOwner ? (
        <ProdSetup
          products={products}
          workers={workers}
          onReload={() => void reloadCatalog().catch((err) => setError((err as Error).message))}
          onError={setError}
        />
      ) : null}
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
    <form className="form-card entry-form" onSubmit={(e) => void onSubmit(e)}>
      {entry ? (
        <div className="entry-toolbar" style={{ position: "static", padding: "0 0 0.45rem" }}>
          <h2 className="panel-title" style={{ fontSize: "1rem" }}>แก้ไขรายการ</h2>
          <button type="button" className="ghost-btn icon-btn" aria-label="ยกเลิกแก้ไข" onClick={onCancelEdit}>
            <X size={18} />
          </button>
        </div>
      ) : (
        <h2 className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.55rem" }}>
          บันทึกผลิต
        </h2>
      )}

      {!products.length || !workers.length ? (
        <p className="muted" style={{ textAlign: "left" }}>
          ยังไม่มีสินค้าหรือรายชื่อพนักงานผลิต — ให้เจ้าของไปแท็บ «ตั้งค่า» ก่อน
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="prod-date">วันที่</label>
        <input id="prod-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>

      <div className="field">
        <span className="field-label">พนักงาน (สูงสุด 2 คน)</span>
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
        <label htmlFor="prod-waste">ทิ้ง / หมดอายุ / เสีย</label>
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

      <div className="field">
        <label htmlFor="prod-note">หมายเหตุ</label>
        <input
          id="prod-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
        />
      </div>

      {Number(qty) > 0 && selectedWorkers.length > 0 ? (
        <p className="muted" style={{ margin: "0 0 0.55rem", textAlign: "left", fontSize: "0.82rem" }}>
          ตัวอย่างโบนัส/คน ≈ {formatPlainNumber(preview.bonusPerPerson)} บาท
          {" "}(ผลิต × เรทผลิต ÷ {preview.workerCount} คน)
        </p>
      ) : null}

      <div className="entry-actions">
        <button type="submit" className="primary-btn action-out" disabled={busy || !products.length}>
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
        {entry ? (
          <button type="button" className="ghost-btn" disabled={busy} onClick={onCancelEdit}>
            ออก
          </button>
        ) : (
          <span aria-hidden style={{ width: "2.6rem" }} />
        )}
        <span aria-hidden style={{ width: "2.6rem" }} />
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
    return <p className="empty">ยังไม่มีรายการผลิต — สลับไปแท็บกรอกเพื่อเริ่ม</p>;
  }

  return (
    <div className="sheet-wrap">
      <table className="sheet-table prod-table">
        <thead>
          <tr>
            <th className="col-date">วันที่</th>
            <th className="col-desc">พนักงาน</th>
            <th className="col-desc">สินค้า</th>
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
                <td className="col-desc">{row.workerNames.join(", ")}</td>
                <td className="col-desc">
                  <button type="button" className="desc-link" onClick={() => onEdit(row)}>
                    {row.productName}
                  </button>
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
                      value={row.status}
                      onChange={(e) => void setStatus(row, e.target.value as ProdStatus)}
                      aria-label="สถานะโบนัส"
                    >
                      <option value="unpaid">ยังไม่จ่าย</option>
                      <option value="paid">จ่ายโบนัสแล้ว</option>
                    </select>
                  ) : (
                    <span className={row.status === "paid" ? "prod-status-pill is-paid" : "prod-status-pill"}>
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
  );
}

function ProdSetup({
  products,
  workers,
  onReload,
  onError,
}: {
  products: ProdProduct[];
  workers: ProdWorker[];
  onReload: () => void;
  onError: (msg: string) => void;
}) {
  const [pName, setPName] = useState("");
  const [salesRate, setSalesRate] = useState("0.60");
  const [prodRate, setProdRate] = useState("1.25");
  const [wName, setWName] = useState("");
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

  async function addWorker(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await addProdWorker(wName);
      setWName("");
      onReload();
    } catch (err) {
      onError((err as Error).message || "เพิ่มพนักงานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prod-setup">
      <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
        เรทขาย / เรทผลิต เป็นค่าตายตัวต่อสินค้า · โบนัส/คน = ผลิต × เรทผลิต ÷ จำนวนคน
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

      <form className="form-card entry-form" style={{ marginTop: "1rem" }} onSubmit={(e) => void addWorker(e)}>
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>พนักงานผลิต</h2>
        <div className="field">
          <label htmlFor="setup-wname">ชื่อ</label>
          <input id="setup-wname" value={wName} onChange={(e) => setWName(e.target.value)} required />
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>เพิ่มชื่อ</button>
      </form>

      <div className="list-card" style={{ marginTop: "0.75rem" }}>
        {workers.map((w) => (
          <div key={w.id} className="list-row">
            <div>
              <strong>{w.name}</strong>
              <div className="muted">{w.active ? "ใช้งาน" : "ปิดใช้"}</div>
            </div>
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                void updateProdWorker(w.id, { active: !w.active })
                  .then(onReload)
                  .catch((err) => onError(err.message || "อัปเดตไม่สำเร็จ"))
              }
            >
              {w.active ? "ปิด" : "เปิด"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
