"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Coffee, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import {
  OT_SHIFTS,
  addOtEntry,
  computeOtBonus,
  deleteOtEntry,
  getOtSettings,
  labelOtShift,
  labelOtStatus,
  saveOtSettings,
  subscribeOtEntries,
  updateOtEntry,
  type OtEntry,
  type OtShiftId,
  type OtStatus,
} from "@/lib/ot";
import {
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

type Tab = "form" | "table" | "setup";

export default function OtPage() {
  return (
    <AuthGate>
      <OtView />
    </AuthGate>
  );
}

function OtView() {
  const { user, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [tab, setTab] = useState<Tab>("form");
  const [entries, setEntries] = useState<OtEntry[]>([]);
  const [workers, setWorkers] = useState<Employee[]>([]);
  const [bonusRate, setBonusRate] = useState(0.6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OtEntry | null>(null);

  async function reloadCatalog() {
    const [emps, settings] = await Promise.all([listActiveEmployees(), getOtSettings()]);
    setWorkers(emps);
    setBonusRate(settings.bonusRate);
  }

  useEffect(() => {
    if (staff && !can(staff, "otBonus")) {
      router.replace("/ledger/");
    }
  }, [staff, router]);

  useEffect(() => {
    if (!can(staff, "otBonus")) return;
    setLoading(true);
    void reloadCatalog()
      .catch((err) => setError((err as Error).message || "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));

    const unsub = subscribeOtEntries(
      (rows) => setEntries(rows),
      (err) => setError(err.message || "โหลดรายการไม่สำเร็จ"),
    );
    return unsub;
  }, [staff]);

  if (!can(staff, "otBonus")) return null;

  return (
    <div>
      <div className="entry-toolbar" style={{ position: "static", paddingTop: 0 }}>
        <h1 className="panel-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Coffee size={20} aria-hidden />
          โบนัส OT / ชง
        </h1>
      </div>

      <div className="prod-tabs" role="tablist" aria-label="มุมมอง OT">
        <button
          type="button"
          role="tab"
          className={tab === "form" ? "prod-tab is-active" : "prod-tab"}
          aria-selected={tab === "form"}
          onClick={() => {
            setTab("form");
            setEditing(null);
          }}
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
        <OtEntryForm
          key={editing?.id || "new"}
          entry={editing}
          workers={workers}
          bonusRate={bonusRate}
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
        <OtTable
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
        <OtSetup
          bonusRate={bonusRate}
          onReload={() => void reloadCatalog().catch((err) => setError((err as Error).message))}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function OtEntryForm({
  entry,
  workers,
  bonusRate,
  createdBy,
  onError,
  onSaved,
  onCancelEdit,
}: {
  entry: OtEntry | null;
  workers: Employee[];
  bonusRate: number;
  createdBy: string;
  onError: (msg: string) => void;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const [date, setDate] = useState(entry ? todayInputValue(new Date(entry.date)) : todayInputValue());
  const [shift, setShift] = useState<OtShiftId>(entry?.shift || "morning");
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>(
    entry?.workerIds?.length ? entry.workerIds : [],
  );
  const [machineCount, setMachineCount] = useState(entry ? String(entry.machineCount) : "");
  const [otherCups, setOtherCups] = useState(entry ? String(entry.otherCups || "") : "");
  const [iceCreamCones, setIceCreamCones] = useState(entry ? String(entry.iceCreamCones || "") : "");
  const [breadSlices, setBreadSlices] = useState(entry ? String(entry.breadSlices || "") : "");
  const [claimCups, setClaimCups] = useState(entry ? String(entry.claimCups || "") : "");
  const [deductQty, setDeductQty] = useState(entry ? String(entry.deductQty || "") : "");
  const [deductReason, setDeductReason] = useState(entry?.deductReason || "");
  const [addQty, setAddQty] = useState(entry ? String(entry.addQty || "") : "");
  const [addReason, setAddReason] = useState(entry?.addReason || "");
  const [busy, setBusy] = useState(false);

  const rate = entry?.bonusRate ?? bonusRate;
  const preview = useMemo(() => {
    const names = workers.filter((w) => selectedWorkers.includes(w.id)).map((w) => w.name);
    return computeOtBonus({
      machineCount: Number(machineCount) || 0,
      otherCups: Number(otherCups) || 0,
      iceCreamCones: Number(iceCreamCones) || 0,
      breadSlices: Number(breadSlices) || 0,
      claimCups: Number(claimCups) || 0,
      deductQty: Number(deductQty) || 0,
      addQty: Number(addQty) || 0,
      bonusRate: rate,
      workerNames: names.length ? names : entry?.workerNames || [],
    });
  }, [
    machineCount,
    otherCups,
    iceCreamCones,
    breadSlices,
    claimCups,
    deductQty,
    addQty,
    rate,
    selectedWorkers,
    workers,
    entry,
  ]);

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
    setBusy(true);
    try {
      const payload = {
        date: parseDateInput(date),
        shift,
        workerIds: chosen.map((w) => w.id),
        workerNames: chosen.map((w) => w.name),
        machineCount: Number(machineCount) || 0,
        otherCups: Number(otherCups) || 0,
        iceCreamCones: Number(iceCreamCones) || 0,
        breadSlices: Number(breadSlices) || 0,
        claimCups: Number(claimCups) || 0,
        deductQty: Number(deductQty) || 0,
        deductReason,
        addQty: Number(addQty) || 0,
        addReason,
        bonusRate: rate,
      };
      if (entry) {
        await updateOtEntry(entry.id, payload);
      } else {
        await addOtEntry({ ...payload, createdBy });
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
          บันทึก OT
        </h2>
      )}

      {!workers.length ? (
        <p className="muted" style={{ textAlign: "left" }}>
          ยังไม่มีรายชื่อพนักงาน — เพิ่มที่{" "}
          <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
        </p>
      ) : null}

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-date">วันที่</label>
          <input id="ot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="ot-shift">รอบงาน</label>
          <select id="ot-shift" value={shift} onChange={(e) => setShift(e.target.value as OtShiftId)} required>
            {OT_SHIFTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
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
        <label htmlFor="ot-machine">เลขเครื่อง (ต่อรอบ)</label>
        <input
          id="ot-machine"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={machineCount}
          onChange={(e) => setMachineCount(e.target.value)}
          required
        />
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-other">แก้วอื่นๆ</label>
          <input id="ot-other" type="number" min="0" step="1" inputMode="numeric" value={otherCups} onChange={(e) => setOtherCups(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot-cone">ไอศครีมโคน</label>
          <input id="ot-cone" type="number" min="0" step="1" inputMode="numeric" value={iceCreamCones} onChange={(e) => setIceCreamCones(e.target.value)} />
        </div>
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-bread">ขนมปังแผ่น</label>
          <input id="ot-bread" type="number" min="0" step="1" inputMode="numeric" value={breadSlices} onChange={(e) => setBreadSlices(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot-claim">แก้วเคลม</label>
          <input id="ot-claim" type="number" min="0" step="1" inputMode="numeric" value={claimCups} onChange={(e) => setClaimCups(e.target.value)} />
        </div>
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-deduct">ลด</label>
          <input id="ot-deduct" type="number" min="0" step="1" inputMode="numeric" value={deductQty} onChange={(e) => setDeductQty(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot-deduct-reason">สาเหตุลด</label>
          <input id="ot-deduct-reason" value={deductReason} onChange={(e) => setDeductReason(e.target.value)} placeholder="เช่น แก้วแตก" />
        </div>
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-add">เพิ่ม</label>
          <input id="ot-add" type="number" min="0" step="1" inputMode="numeric" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot-add-reason">สาเหตุเพิ่ม</label>
          <input id="ot-add-reason" value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="เช่น ไม่ปิดฝา" />
        </div>
      </div>

      <p className="muted" style={{ textAlign: "left", margin: "0.25rem 0 0.65rem" }}>
        สรุป {formatPlainNumber(preview.summaryQty)} · รวมโบนัส ฿{formatPlainNumber(preview.totalBonus)} ·{" "}
        <strong>โบนัส/คน ฿{formatPlainNumber(preview.bonusPerPerson)}</strong>
        {" "}(เรท {formatPlainNumber(rate)})
      </p>

      <button type="submit" className="primary-btn" disabled={busy || !workers.length}>
        {busy ? "กำลังบันทึก..." : entry ? "บันทึกการแก้ไข" : "บันทึก"}
      </button>
    </form>
  );
}

function OtTable({
  entries,
  isOwner,
  onEdit,
  onError,
}: {
  entries: OtEntry[];
  isOwner: boolean;
  onEdit: (row: OtEntry) => void;
  onError: (msg: string) => void;
}) {
  async function setStatus(row: OtEntry, status: OtStatus) {
    try {
      await updateOtEntry(row.id, { status });
    } catch (err) {
      onError((err as Error).message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  if (!entries.length) {
    return <p className="empty">ยังไม่มีรายการ OT</p>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table dense-table">
        <thead>
          <tr>
            <th>วันที่</th>
            <th>รอบ</th>
            <th>คน</th>
            <th>เครื่อง</th>
            {isOwner ? (
              <>
                <th>อื่นๆ</th>
                <th>โคน</th>
                <th>ขนมปัง</th>
                <th>เคลม</th>
                <th>ลด</th>
                <th>เพิ่ม</th>
                <th>สรุป</th>
                <th>รวม</th>
              </>
            ) : null}
            <th>โบนัส/คน</th>
            <th>สถานะ</th>
            {isOwner ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((row) => {
            const c = computeOtBonus(row);
            return (
              <tr key={row.id}>
                <td>
                  <button type="button" className="linkish" onClick={() => onEdit(row)}>
                    {formatDateShort(row.date)}
                  </button>
                </td>
                <td style={{ fontSize: "0.72rem", whiteSpace: "nowrap" }}>{labelOtShift(row.shift)}</td>
                <td>{row.workerNames.join(", ")}</td>
                <td className="num">{formatPlainNumber(row.machineCount)}</td>
                {isOwner ? (
                  <>
                    <td className="num">{formatPlainNumber(row.otherCups || 0)}</td>
                    <td className="num">{formatPlainNumber(row.iceCreamCones || 0)}</td>
                    <td className="num">{formatPlainNumber(row.breadSlices || 0)}</td>
                    <td className="num">{formatPlainNumber(row.claimCups || 0)}</td>
                    <td className="num" title={row.deductReason || undefined}>
                      {formatPlainNumber(row.deductQty || 0)}
                    </td>
                    <td className="num" title={row.addReason || undefined}>
                      {formatPlainNumber(row.addQty || 0)}
                    </td>
                    <td className="num">{formatPlainNumber(c.summaryQty)}</td>
                    <td className="num">{formatPlainNumber(c.totalBonus)}</td>
                  </>
                ) : null}
                <td className="num">
                  <strong>{formatPlainNumber(c.bonusPerPerson)}</strong>
                </td>
                <td>
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
                      onChange={(e) => void setStatus(row, e.target.value as OtStatus)}
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
                      {labelOtStatus(row.status)}
                    </span>
                  )}
                </td>
                {isOwner ? (
                  <td>
                    <button
                      type="button"
                      className="ghost-btn icon-btn"
                      aria-label="ลบ"
                      onClick={() =>
                        void deleteOtEntry(row.id).catch((err) =>
                          onError(err.message || "ลบไม่สำเร็จ"),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OtSetup({
  bonusRate,
  onReload,
  onError,
}: {
  bonusRate: number;
  onReload: () => void;
  onError: (msg: string) => void;
}) {
  const [rate, setRate] = useState(String(bonusRate));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRate(String(bonusRate));
  }, [bonusRate]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveOtSettings(Number(rate));
      onReload();
    } catch (err) {
      onError((err as Error).message || "บันทึกเรทไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prod-setup">
      <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
        โบนัส/คน = (เลขเครื่อง + อื่นๆ + โคน + ขนมปัง − เคลม − ลด + เพิ่ม) × เรท ÷ จำนวนคน
      </p>
      <p className="muted" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
        รายชื่อพนักงานอยู่ที่{" "}
        <a href="/staff/" style={{ fontWeight: 700 }}>ศูนย์รวมพนักงาน</a>
        {" "}· วันที่เก็บแบบ ว/ด/ป · ไม่ต้องเคลียร์ตารางสิ้นเดือน (ใช้สถานะจ่ายแทน)
      </p>

      <form className="form-card entry-form" onSubmit={(e) => void onSave(e)}>
        <h2 className="panel-title" style={{ fontSize: "1rem" }}>เรทโบนัส / หน่วย</h2>
        <div className="field">
          <label htmlFor="ot-rate">บาทต่อหน่วย</label>
          <input
            id="ot-rate"
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึกเรท"}
        </button>
      </form>
    </div>
  );
}
