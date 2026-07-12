"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Coffee, LayoutGrid, Lock, Table2, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { BulkStatusToolbar } from "@/components/BulkStatusToolbar";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { PhotoAttachField } from "@/components/PhotoAttachField";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useAuth } from "@/lib/auth";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import {
  OT_SHIFTS,
  addOtEntry,
  bulkUpdateOtEntryStatus,
  computeOtBonus,
  deleteOtEntry,
  getOtSettings,
  isOtEntryLocked,
  labelOtShift,
  labelOtStatus,
  subscribeOtEntries,
  updateOtEntry,
  type OtEntry,
  type OtShiftId,
  type OtStatus,
} from "@/lib/ot";
import type { StaffMember } from "@/lib/types";
import {
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

type TableView = "sheet" | "cards";

const SHIFT_ORDER: Record<OtShiftId, number> = {
  morning: 0,
  evening: 1,
  late: 2,
};

function monthInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseMonthInput(value: string) {
  const [y, m] = value.split("-").map(Number);
  return { year: y, month: m - 1 };
}

function isInMonth(ms: number, year: number, month: number) {
  const d = new Date(ms);
  return d.getFullYear() === year && d.getMonth() === month;
}

function entryIncludesName(entry: OtEntry, name: string) {
  if (!name.trim()) return false;
  const needle = name.trim().toLowerCase();
  return entry.workerNames.some((w) => {
    const hay = w.trim().toLowerCase();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

function sortOtEntries(rows: OtEntry[]) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return b.date - a.date;
    const sa = SHIFT_ORDER[a.shift] ?? 9;
    const sb = SHIFT_ORDER[b.shift] ?? 9;
    if (sa !== sb) return sb - sa;
    return b.createdAt - a.createdAt;
  });
}

function otQtyCell(n: number) {
  return n ? formatPlainNumber(n) : "—";
}

function otFormulaText(entry: OtEntry, computed: ReturnType<typeof computeOtBonus>) {
  const m = Number(entry.machineCount) || 0;
  const o = Number(entry.otherCups) || 0;
  const c = Number(entry.iceCreamCones) || 0;
  const b = Number(entry.breadSlices) || 0;
  const cl = Number(entry.claimCups) || 0;
  const d = Number(entry.deductQty) || 0;
  const a = Number(entry.addQty) || 0;
  const rate = Number(entry.bonusRate) || 0;
  return (
    `(${m} + ${o} + ${c} + ${b} − ${cl} − ${d} + ${a}) × ${formatPlainNumber(rate)} ÷ ${computed.workerCount} = ฿${formatPlainNumber(computed.bonusPerPerson)}`
  );
}

type DateGroup = {
  date: number;
  rows: OtEntry[];
  shiftCount: number;
  summaryQty: number;
  totalBonus: number;
  missing: boolean;
};

function localDayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function groupByDateForMonth(rows: OtEntry[], year: number, month: number): DateGroup[] {
  const byDay = new Map<string, OtEntry[]>();
  for (const row of rows) {
    const key = localDayKey(row.date);
    const list = byDay.get(key) || [];
    list.push(row);
    byDay.set(key, list);
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => {
      const sa = SHIFT_ORDER[a.shift] ?? 9;
      const sb = SHIFT_ORDER[b.shift] ?? 9;
      if (sa !== sb) return sb - sa;
      return b.createdAt - a.createdAt;
    });
  }

  const lastDay = new Date(year, month + 1, 0).getDate();
  const groups: DateGroup[] = [];

  for (let day = lastDay; day >= 1; day -= 1) {
    const dateMs = new Date(year, month, day).getTime();
    const key = `${year}-${month}-${day}`;
    const dayRows = byDay.get(key) || [];

    if (!dayRows.length) {
      groups.push({
        date: dateMs,
        rows: [],
        shiftCount: 0,
        summaryQty: 0,
        totalBonus: 0,
        missing: true,
      });
      continue;
    }

    let shiftCount = 0;
    let summaryQty = 0;
    let totalBonus = 0;
    for (const row of dayRows) {
      const c = computeOtBonus(row);
      shiftCount += 1;
      summaryQty += c.summaryQty;
      totalBonus += c.totalBonus;
    }
    groups.push({
      date: dateMs,
      rows: dayRows,
      shiftCount,
      summaryQty,
      totalBonus,
      missing: false,
    });
  }

  return groups;
}

export default function OtPage() {
  return (
    <AuthGate>
      <OtView />
    </AuthGate>
  );
}

function OtView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [formOpen, setFormOpen] = useState(false);
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

  useBodyScrollLock(formOpen);

  if (!can(staff, "otBonus")) return null;

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(row: OtEntry) {
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
          <Coffee size={18} aria-hidden />
          โบนัส OT / ชง
        </h1>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <OtTable
          entries={entries}
          staff={staff}
          isOwner={isOwner}
          onEdit={openEdit}
          onError={setError}
        />
      ) : null}

      {formOpen && !loading ? (
        <div className="modal-backdrop edit-modal is-module-form" onClick={closeForm}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <OtEntryForm
              key={editing?.id || "new"}
              entry={editing}
              workers={workers}
              bonusRate={bonusRate}
              createdBy={actorId}
              onError={setError}
              onSaved={closeForm}
              onCancelEdit={closeForm}
            />
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        ariaLabel="มุมมอง OT"
        formOpen={formOpen}
        onAdd={openAdd}
      />
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
  const [imageUrl, setImageUrl] = useState(entry?.imageUrl || "");
  const [busy, setBusy] = useState(false);
  const locked = entry ? isOtEntryLocked(entry) : false;

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
        imageUrl,
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
    <form className="form-card entry-form module-entry-form" onSubmit={(e) => void onSubmit(e)}>
      <div className="entry-toolbar module-form-head">
        <h2 className="panel-title">{entry ? (locked ? "ดูรายการ (จ่ายแล้ว)" : "แก้ไขรายการ") : "บันทึก OT"}</h2>
        <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" disabled={busy} onClick={onCancelEdit}>
          <X size={18} />
        </button>
      </div>

      {locked ? (
        <p className="muted form-hint-inline prod-locked-hint">
          <Lock size={14} aria-hidden /> จ่ายโบนัสแล้ว — เรทและยอดล็อก · เปลี่ยนสถานะได้ที่ตาราง
        </p>
      ) : null}

      {!workers.length ? (
        <p className="muted form-hint-inline">
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
          <label htmlFor="ot-shift">รอบ</label>
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
          <label htmlFor="ot-machine">เครื่อง</label>
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
        <div className="field">
          <label htmlFor="ot-other">แก้วอื่นๆ</label>
          <input id="ot-other" type="number" min="0" step="1" inputMode="numeric" value={otherCups} onChange={(e) => setOtherCups(e.target.value)} />
        </div>
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-cone">โคน</label>
          <input id="ot-cone" type="number" min="0" step="1" inputMode="numeric" value={iceCreamCones} onChange={(e) => setIceCreamCones(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot-bread">ขนมปัง</label>
          <input id="ot-bread" type="number" min="0" step="1" inputMode="numeric" value={breadSlices} onChange={(e) => setBreadSlices(e.target.value)} />
        </div>
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-claim">เคลม</label>
          <input id="ot-claim" type="number" min="0" step="1" inputMode="numeric" value={claimCups} onChange={(e) => setClaimCups(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ot-deduct">ลด</label>
          <input id="ot-deduct" type="number" min="0" step="1" inputMode="numeric" value={deductQty} onChange={(e) => setDeductQty(e.target.value)} />
        </div>
      </div>

      <div className="stock-form-grid">
        <div className="field">
          <label htmlFor="ot-deduct-reason">สาเหตุลด</label>
          <input id="ot-deduct-reason" value={deductReason} onChange={(e) => setDeductReason(e.target.value)} placeholder="แก้วแตก" />
        </div>
        <div className="field">
          <label htmlFor="ot-add">เพิ่ม</label>
          <input id="ot-add" type="number" min="0" step="1" inputMode="numeric" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="ot-add-reason">สาเหตุเพิ่ม</label>
        <input id="ot-add-reason" value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="ไม่ปิดฝา" />
      </div>

      {!locked ? (
        <PhotoAttachField value={imageUrl} onChange={setImageUrl} onError={onError} label="แนบรูป" />
      ) : null}

      <p className="muted form-hint-inline">
        สรุป {formatPlainNumber(preview.summaryQty)} · ฿{formatPlainNumber(preview.totalBonus)} ·{" "}
        <strong>฿{formatPlainNumber(preview.bonusPerPerson)}/คน</strong>
        {locked ? ` · เรท ${formatPlainNumber(rate)}` : ""}
      </p>

      <div className="entry-actions module-form-actions">
        {!locked ? (
          <button type="submit" className="primary-btn" disabled={busy || !workers.length}>
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

function OtTable({
  entries,
  staff,
  isOwner,
  onEdit,
  onError,
}: {
  entries: OtEntry[];
  staff: StaffMember | null;
  isOwner: boolean;
  onEdit: (row: OtEntry) => void;
  onError: (msg: string) => void;
}) {
  const [tableView, setTableView] = useState<TableView>("sheet");
  const [month, setMonth] = useState(monthInputValue());
  const [statusFilter, setStatusFilter] = useState<OtStatus | "all">("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useBodyScrollLock(!!preview);

  const myName = staff?.displayName || "";

  const filtered = useMemo(() => {
    const { year, month: m } = parseMonthInput(month);
    return entries.filter((row) => {
      if (!isInMonth(row.date, year, m)) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (mineOnly && !entryIncludesName(row, myName)) return false;
      return true;
    });
  }, [entries, month, statusFilter, mineOnly, myName]);

  const summary = useMemo(() => {
    let shiftCount = 0;
    let summaryQty = 0;
    let totalBonus = 0;
    let unpaidBonus = 0;
    let myBonus = 0;

    for (const row of filtered) {
      const c = computeOtBonus(row);
      shiftCount += 1;
      summaryQty += c.summaryQty;
      totalBonus += c.totalBonus;
      if (row.status === "unpaid") unpaidBonus += c.totalBonus;
      if (entryIncludesName(row, myName)) myBonus += c.bonusPerPerson;
    }

    return { shiftCount, summaryQty, totalBonus, unpaidBonus, myBonus };
  }, [filtered, myName]);

  const dateGroups = useMemo(() => {
    const { year, month: m } = parseMonthInput(month);
    return groupByDateForMonth(filtered, year, m);
  }, [filtered, month]);

  const unpaidIds = useMemo(
    () => filtered.filter((r) => r.status === "unpaid").map((r) => r.id),
    [filtered],
  );
  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  async function onBulkStatus(status: OtStatus) {
    const ids = [...selected];
    if (!ids.length) return;
    const label = labelOtStatus(status);
    if (!window.confirm(`เปลี่ยนสถานะ ${ids.length} รายการเป็น "${label}"?`)) return;
    setBulkBusy(true);
    onError("");
    try {
      await bulkUpdateOtEntryStatus(ids, status);
      setSelected(new Set());
    } catch (err) {
      onError((err as Error).message || "อัปเดตกลุ่มไม่สำเร็จ");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="ot-table-view">
      <div className="ot-toolbar-slim">
        <input
          id="ot-month"
          type="month"
          className="ot-slim-input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="เดือน"
        />
        <select
          id="ot-status-filter"
          className="ot-slim-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OtStatus | "all")}
          aria-label="สถานะ"
        >
          <option value="all">ทั้งหมด</option>
          <option value="unpaid">ยังไม่จ่าย</option>
          <option value="pending">เตรียมจ่าย</option>
          <option value="paid">จ่ายแล้ว</option>
        </select>
        {myName ? (
          <label className="ot-slim-chip">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            ของฉัน
          </label>
        ) : null}
        <div className="ot-view-toggle ot-view-toggle-slim" role="group" aria-label="มุมมองตาราง">
          <button
            type="button"
            className={tableView === "sheet" ? "ot-view-btn is-active" : "ot-view-btn"}
            onClick={() => setTableView("sheet")}
            aria-pressed={tableView === "sheet"}
            aria-label="Sheet"
          >
            <Table2 size={13} aria-hidden />
          </button>
          <button
            type="button"
            className={tableView === "cards" ? "ot-view-btn is-active" : "ot-view-btn"}
            onClick={() => setTableView("cards")}
            aria-pressed={tableView === "cards"}
            aria-label="การ์ด"
          >
            <LayoutGrid size={13} aria-hidden />
          </button>
        </div>
      </div>

      <p className="ot-summary-inline muted">
        รอบ {summary.shiftCount} · หน่วย {formatPlainNumber(summary.summaryQty)} ·{" "}
        {mineOnly ? "ของฉัน" : "รวม"} ฿{formatPlainNumber(mineOnly ? summary.myBonus : summary.totalBonus)} ·{" "}
        ค้าง ฿{formatPlainNumber(summary.unpaidBonus)}
      </p>

      {isOwner ? (
        <BulkStatusToolbar
          selectedCount={selected.size}
          onSelectUnpaid={() => setSelected(new Set(unpaidIds))}
          onSelectVisible={() => setSelected(new Set(visibleIds))}
          onClear={() => setSelected(new Set())}
          onSetStatus={(s) => void onBulkStatus(s as OtStatus)}
          busy={bulkBusy}
          visibleCount={visibleIds.length}
          unpaidCount={unpaidIds.length}
        />
      ) : null}

      {tableView === "sheet" ? (
        <OtSheetTable
          groups={dateGroups}
          isOwner={isOwner}
          selected={selected}
          allVisibleSelected={allVisibleSelected}
          someSelected={someSelected}
          onToggleRow={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleAllVisible={() =>
            setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))
          }
          onEdit={onEdit}
          onError={onError}
          onViewPhoto={(url, title) => setPreview({ url, title })}
        />
      ) : !filtered.length ? (
        <p className="empty">{entries.length ? "ไม่มีรายการในเดือน/ตัวกรองนี้" : "ยังไม่มีรายการ OT"}</p>
      ) : (
        <OtCardList
          entries={sortOtEntries(filtered)}
          isOwner={isOwner}
          selected={selected}
          onToggleRow={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onEdit={onEdit}
          onError={onError}
          onViewPhoto={(url, title) => setPreview({ url, title })}
        />
      )}
      {preview ? (
        <ImagePreviewModal url={preview.url} title={preview.title} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function OtSheetTable({
  groups,
  isOwner,
  selected,
  allVisibleSelected,
  someSelected,
  onToggleRow,
  onToggleAllVisible,
  onEdit,
  onError,
  onViewPhoto,
}: {
  groups: DateGroup[];
  isOwner: boolean;
  selected: Set<string>;
  allVisibleSelected: boolean;
  someSelected: boolean;
  onToggleRow: (id: string) => void;
  onToggleAllVisible: () => void;
  onEdit: (row: OtEntry) => void;
  onError: (msg: string) => void;
  onViewPhoto: (url: string, title: string) => void;
}) {
  async function setStatus(row: OtEntry, status: OtStatus) {
    try {
      await updateOtEntry(row.id, { status });
    } catch (err) {
      onError((err as Error).message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  const colCount = 20 + (isOwner ? 2 : 0);

  return (
    <div className="sheet-wrap ot-sheet-wrap">
      <table className="sheet-table ot-table">
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
                  onChange={onToggleAllVisible}
                  aria-label="เลือกทั้งหมดที่แสดง"
                />
              </th>
            ) : null}
            <th className="ot-th-staff col-sticky-left ot-col-date">วันที่</th>
            <th className="ot-th-staff ot-col-worker">พนักงาน-1</th>
            <th className="ot-th-staff ot-col-worker">พนักงาน-2</th>
            <th className="ot-th-staff ot-col-shift">รอบงาน</th>
            <th className="ot-th-machine col-out">เครื่อง</th>
            <th className="ot-th-prod col-out">อื่นๆ</th>
            <th className="ot-th-prod col-out">โคน</th>
            <th className="ot-th-prod col-out">ขนมปัง</th>
            <th className="ot-th-prod col-out">เคลม</th>
            <th className="ot-th-deduct col-out">ลด</th>
            <th className="ot-th-deduct col-note">สาเหตุลด</th>
            <th className="ot-th-add col-out">เพิ่ม</th>
            <th className="ot-th-add col-note">สาเหตุเพิ่ม</th>
            <th className="ot-th-result col-out">สรุป</th>
            <th className="ot-th-result col-out">เรท</th>
            <th className="ot-th-result col-out">รวม</th>
            <th className="ot-th-result ot-col-bonus col-sticky-right">โบนัส/คน</th>
            <th className="ot-th-result col-act">คน</th>
            <th className="ot-th-result col-act">สถานะ</th>
            <th className="ot-th-result col-act">รูป</th>
            {isOwner ? <th className="ot-th-result col-act" /> : null}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) =>
            group.missing ? (
              <tr key={group.date} className="ot-day-missing row-out">
                <td className="col-sticky-left ot-col-date ot-date-cell">{formatDateShort(group.date)}</td>
                <td colSpan={colCount - 1} className="ot-missing-cell">
                  ไม่มีบันทึก — ช่วงที่ขาด
                </td>
              </tr>
            ) : (
            <Fragment key={group.date}>
              {group.rows.map((row, idx) => {
                const c = computeOtBonus(row);
                const statusClass =
                  row.status === "paid"
                    ? "is-paid"
                    : row.status === "pending"
                      ? "is-pending"
                      : "";
                const w1 = row.workerNames[0] || "—";
                const w2 = row.workerNames[1] || "—";

                return (
                  <tr key={row.id} className={isOtEntryLocked(row) ? "row-out prod-row-paid" : "row-out"}>
                    {isOwner ? (
                      <td className="col-act bulk-check-col">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => onToggleRow(row.id)}
                          aria-label={`เลือก ${formatDateShort(row.date)}`}
                        />
                      </td>
                    ) : null}
                    {idx === 0 ? (
                      <td className="col-sticky-left ot-col-date ot-date-cell" rowSpan={group.rows.length}>
                        <button type="button" className="desc-link" onClick={() => onEdit(row)}>
                          {formatDateShort(group.date)}
                        </button>
                      </td>
                    ) : null}
                    <td className="ot-col-worker">{w1}</td>
                    <td className="ot-col-worker">{w2}</td>
                    <td className="ot-col-shift">{labelOtShift(row.shift)}</td>
                    <td className="col-out">{formatPlainNumber(row.machineCount)}</td>
                    <td className="col-out">{otQtyCell(row.otherCups || 0)}</td>
                    <td className="col-out">{otQtyCell(row.iceCreamCones || 0)}</td>
                    <td className="col-out">{otQtyCell(row.breadSlices || 0)}</td>
                    <td className="col-out">{otQtyCell(row.claimCups || 0)}</td>
                    <td className="col-out">{otQtyCell(row.deductQty || 0)}</td>
                    <td className="col-note" title={row.deductReason || ""}>{row.deductReason || "—"}</td>
                    <td className="col-out">{otQtyCell(row.addQty || 0)}</td>
                    <td className="col-note" title={row.addReason || ""}>{row.addReason || "—"}</td>
                    <td className="col-out">{formatPlainNumber(c.summaryQty)}</td>
                    <td className="col-out">{formatPlainNumber(row.bonusRate)}</td>
                    <td className="col-out">฿{formatPlainNumber(c.totalBonus)}</td>
                    <td
                      className="col-sticky-right ot-col-bonus ot-bonus-cell"
                      title={otFormulaText(row, c)}
                    >
                      ฿{formatPlainNumber(c.bonusPerPerson)}
                    </td>
                    <td className="col-act">{c.workerCount}</td>
                    <td className="col-act">
                      {isOwner ? (
                        <select
                          className={`prod-status ${statusClass}`}
                          value={row.status}
                          onChange={(e) => void setStatus(row, e.target.value as OtStatus)}
                          aria-label="สถานะโบนัส"
                        >
                          <option value="unpaid">ยังไม่จ่าย</option>
                          <option value="pending">เตรียมจ่าย</option>
                          <option value="paid">จ่ายแล้ว</option>
                        </select>
                      ) : (
                        <span className={`prod-status-pill ${statusClass}`}>
                          {labelOtStatus(row.status)}
                        </span>
                      )}
                    </td>
                    <td className="col-act">
                      <EntryPhotoIndicator
                        imageUrl={row.imageUrl}
                        label={`${formatDateShort(row.date)} ${labelOtShift(row.shift)}`}
                        onView={(url) =>
                          onViewPhoto(url, `${formatDateShort(row.date)} ${labelOtShift(row.shift)}`)
                        }
                      />
                    </td>
                    {isOwner && !isOtEntryLocked(row) ? (
                      <td className="col-act">
                        <button
                          type="button"
                          className="trash-btn"
                          aria-label="ลบ"
                          onClick={() => {
                            if (!window.confirm("ลบรายการนี้?")) return;
                            void deleteOtEntry(row.id).catch((err) =>
                              onError(err.message || "ลบไม่สำเร็จ"),
                            );
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    ) : isOwner ? (
                      <td className="col-act" />
                    ) : null}
                  </tr>
                );
              })}
              <tr className="ot-day-summary">
                <td colSpan={colCount}>
                  สรุป {formatDateShort(group.date)}: {group.shiftCount} รอบ · สรุปหน่วย{" "}
                  {formatPlainNumber(group.summaryQty)} · โบนัสรวม ฿{formatPlainNumber(group.totalBonus)}
                </td>
              </tr>
            </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function OtCardList({
  entries,
  isOwner,
  selected,
  onToggleRow,
  onEdit,
  onError,
  onViewPhoto,
}: {
  entries: OtEntry[];
  isOwner: boolean;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onEdit: (row: OtEntry) => void;
  onError: (msg: string) => void;
  onViewPhoto: (url: string, title: string) => void;
}) {
  async function setStatus(row: OtEntry, status: OtStatus) {
    try {
      await updateOtEntry(row.id, { status });
    } catch (err) {
      onError((err as Error).message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  return (
    <div className="ot-list">
      {entries.map((row) => {
        const c = computeOtBonus(row);
        const statusClass =
          row.status === "paid"
            ? "is-paid"
            : row.status === "pending"
              ? "is-pending"
              : "";
        const detailItems = [
          { label: "เครื่อง", value: formatPlainNumber(row.machineCount) },
          { label: "อื่นๆ", value: otQtyCell(row.otherCups || 0) },
          { label: "โคน", value: otQtyCell(row.iceCreamCones || 0) },
          { label: "ขนมปัง", value: otQtyCell(row.breadSlices || 0) },
          { label: "เคลม", value: otQtyCell(row.claimCups || 0) },
          {
            label: "ลด",
            value: otQtyCell(row.deductQty || 0),
            title: row.deductReason || undefined,
          },
          {
            label: "เพิ่ม",
            value: otQtyCell(row.addQty || 0),
            title: row.addReason || undefined,
          },
          { label: "สรุป", value: formatPlainNumber(c.summaryQty) },
          { label: "รวม", value: `฿${formatPlainNumber(c.totalBonus)}` },
        ];

        return (
          <article key={row.id} className={isOtEntryLocked(row) ? "ot-card prod-row-paid" : "ot-card"}>
            <header className="ot-card-head">
              <div className="ot-card-meta">
                {isOwner ? (
                  <input
                    type="checkbox"
                    className="ot-card-check"
                    checked={selected.has(row.id)}
                    onChange={() => onToggleRow(row.id)}
                    aria-label="เลือกรายการ"
                  />
                ) : null}
                <button type="button" className="desc-link ot-card-date" onClick={() => onEdit(row)}>
                  {isOtEntryLocked(row) ? <Lock size={11} aria-hidden /> : null} {formatDateShort(row.date)}
                </button>
                <span className="ot-card-shift">{labelOtShift(row.shift)}</span>
              </div>
              <div className="ot-card-actions">
                <EntryPhotoIndicator
                  imageUrl={row.imageUrl}
                  label={`${formatDateShort(row.date)} ${labelOtShift(row.shift)}`}
                  onView={(url) =>
                    onViewPhoto(url, `${formatDateShort(row.date)} ${labelOtShift(row.shift)}`)
                  }
                />
                {isOwner ? (
                  <select
                    className={`prod-status ot-card-status ${statusClass}`}
                    value={row.status}
                    onChange={(e) => void setStatus(row, e.target.value as OtStatus)}
                    aria-label="สถานะโบนัส"
                  >
                    <option value="unpaid">ยังไม่จ่าย</option>
                    <option value="pending">เตรียมจ่ายโบนัส</option>
                    <option value="paid">จ่ายโบนัสแล้ว</option>
                  </select>
                ) : (
                  <span className={`prod-status-pill ${statusClass}`}>
                    {labelOtStatus(row.status)}
                  </span>
                )}
                {isOwner && !isOtEntryLocked(row) ? (
                  <button
                    type="button"
                    className="ghost-btn icon-btn"
                    aria-label="ลบ"
                    onClick={() => {
                      if (!window.confirm("ลบรายการนี้?")) return;
                      void deleteOtEntry(row.id).catch((err) =>
                        onError(err.message || "ลบไม่สำเร็จ"),
                      );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
            </header>

            <p className="ot-card-workers">{row.workerNames.join(", ")}</p>

            <p className="ot-card-bonus" title={otFormulaText(row, c)}>
              โบนัส/คน <strong>฿{formatPlainNumber(c.bonusPerPerson)}</strong>
            </p>

            <dl className="ot-card-grid">
              {detailItems.map((item) => (
                <div key={item.label} className="ot-card-stat" title={item.title}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        );
      })}
    </div>
  );
}
