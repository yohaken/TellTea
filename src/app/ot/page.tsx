"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Coffee, LayoutGrid, Table2, Trash2, X } from "lucide-react";
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
import type { StaffMember } from "@/lib/types";
import {
  formatDateShort,
  formatPlainNumber,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

type Tab = "form" | "table" | "setup";
type TableView = "sheet" | "cards";

const SHIFT_ORDER: Record<OtShiftId, number> = {
  morning: 0,
  evening: 1,
  late: 2,
};

const OT_ONBOARDING_KEY = "telltea-ot-onboarding-dismissed";

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
    if (a.date !== b.date) return a.date - b.date;
    const sa = SHIFT_ORDER[a.shift] ?? 9;
    const sb = SHIFT_ORDER[b.shift] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.createdAt - b.createdAt;
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
};

function groupByDate(rows: OtEntry[]): DateGroup[] {
  const sorted = sortOtEntries(rows);
  const groups: DateGroup[] = [];
  for (const row of sorted) {
    let group = groups.find((g) => g.date === row.date);
    if (!group) {
      group = { date: row.date, rows: [], shiftCount: 0, summaryQty: 0, totalBonus: 0 };
      groups.push(group);
    }
    group.rows.push(row);
    const c = computeOtBonus(row);
    group.shiftCount += 1;
    group.summaryQty += c.summaryQty;
    group.totalBonus += c.totalBonus;
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
          staff={staff}
          isOwner={isOwner}
          bonusRate={bonusRate}
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
  staff,
  isOwner,
  bonusRate,
  onEdit,
  onError,
}: {
  entries: OtEntry[];
  staff: StaffMember | null;
  isOwner: boolean;
  bonusRate: number;
  onEdit: (row: OtEntry) => void;
  onError: (msg: string) => void;
}) {
  const [tableView, setTableView] = useState<TableView>("sheet");
  const [month, setMonth] = useState(monthInputValue());
  const [statusFilter, setStatusFilter] = useState<OtStatus | "all">("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const myName = staff?.displayName || "";

  useEffect(() => {
    try {
      setShowOnboarding(localStorage.getItem(OT_ONBOARDING_KEY) !== "1");
    } catch {
      setShowOnboarding(true);
    }
  }, []);

  function dismissOnboarding() {
    setShowOnboarding(false);
    try {
      localStorage.setItem(OT_ONBOARDING_KEY, "1");
    } catch {
      /* ignore */
    }
  }

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

  const dateGroups = useMemo(() => groupByDate(filtered), [filtered]);

  if (!entries.length) {
    return <p className="empty">ยังไม่มีรายการ OT</p>;
  }

  return (
    <div className="ot-table-view">
      {showOnboarding ? (
        <div className="ot-onboarding">
          <div>
            <strong>เหมือน Sheet เดิม — คอลัมน์เดิม สูตรเดิม แค่ย้ายมาออนไลน์</strong>
            <p className="muted" style={{ margin: "0.35rem 0 0", textAlign: "left" }}>
              กรอก = แถวใหม่ · ตาราง = ดูภาพรวมทั้งเดือน · สถานะ = แทนการเคลียร์ตารางสิ้นเดือน
            </p>
          </div>
          <button type="button" className="ghost-btn icon-btn" aria-label="ปิดคำแนะนำ" onClick={dismissOnboarding}>
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="ot-filters">
        <div className="field ot-filter-field">
          <label htmlFor="ot-month">เดือน</label>
          <input id="ot-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="field ot-filter-field">
          <label htmlFor="ot-status-filter">สถานะ</label>
          <select
            id="ot-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OtStatus | "all")}
          >
            <option value="all">ทั้งหมด</option>
            <option value="unpaid">ยังไม่จ่าย</option>
            <option value="pending">เตรียมจ่ายโบนัส</option>
            <option value="paid">จ่ายโบนัสแล้ว</option>
          </select>
        </div>
        {myName ? (
          <label className="ot-mine-toggle">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            ของฉัน ({myName})
          </label>
        ) : null}
        <div className="ot-view-toggle" role="group" aria-label="มุมมองตาราง">
          <button
            type="button"
            className={tableView === "sheet" ? "ot-view-btn is-active" : "ot-view-btn"}
            onClick={() => setTableView("sheet")}
            aria-pressed={tableView === "sheet"}
          >
            <Table2 size={14} aria-hidden />
            Sheet
          </button>
          <button
            type="button"
            className={tableView === "cards" ? "ot-view-btn is-active" : "ot-view-btn"}
            onClick={() => setTableView("cards")}
            aria-pressed={tableView === "cards"}
          >
            <LayoutGrid size={14} aria-hidden />
            การ์ด
          </button>
        </div>
      </div>

      <div className="ot-summary">
        <div className="ot-summary-stat">
          <span className="ot-summary-label">รอบงาน</span>
          <strong>{summary.shiftCount}</strong>
        </div>
        <div className="ot-summary-stat">
          <span className="ot-summary-label">สรุปหน่วย</span>
          <strong>{formatPlainNumber(summary.summaryQty)}</strong>
        </div>
        <div className="ot-summary-stat">
          <span className="ot-summary-label">{mineOnly ? "โบนัสของฉัน" : "โบนัสรวม"}</span>
          <strong>
            ฿{formatPlainNumber(mineOnly ? summary.myBonus : summary.totalBonus)}
          </strong>
        </div>
        <div className="ot-summary-stat">
          <span className="ot-summary-label">ยังไม่จ่าย</span>
          <strong>฿{formatPlainNumber(summary.unpaidBonus)}</strong>
        </div>
      </div>

      <p className="ot-formula-banner muted">
        โบนัส/คน = (เครื่อง + อื่นๆ + โคน + ขนมปัง − เคลม − ลด + เพิ่ม) × เรท ÷ จำนวนคน
        {" · "}เรทปัจจุบัน ฿{formatPlainNumber(bonusRate)}/หน่วย
      </p>

      {!filtered.length ? (
        <p className="empty">ไม่มีรายการในเดือน/ตัวกรองนี้</p>
      ) : tableView === "sheet" ? (
        <OtSheetTable
          groups={dateGroups}
          isOwner={isOwner}
          onEdit={onEdit}
          onError={onError}
        />
      ) : (
        <OtCardList
          entries={sortOtEntries(filtered).reverse()}
          isOwner={isOwner}
          onEdit={onEdit}
          onError={onError}
        />
      )}
    </div>
  );
}

function OtSheetTable({
  groups,
  isOwner,
  onEdit,
  onError,
}: {
  groups: DateGroup[];
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

  const colCount = 19 + (isOwner ? 1 : 0);

  return (
    <div className="sheet-wrap ot-sheet-wrap">
      <table className="sheet-table ot-table">
        <thead>
          <tr>
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
            {isOwner ? <th className="ot-th-result col-act" /> : null}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
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
                  <tr key={row.id} className="row-out">
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
                    {isOwner ? (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OtCardList({
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
          <article key={row.id} className="ot-card">
            <header className="ot-card-head">
              <div className="ot-card-meta">
                <button type="button" className="desc-link ot-card-date" onClick={() => onEdit(row)}>
                  {formatDateShort(row.date)}
                </button>
                <span className="ot-card-shift">{labelOtShift(row.shift)}</span>
              </div>
              <div className="ot-card-actions">
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
                {isOwner ? (
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
