"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Settings, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import {
  deleteStockCountSession,
  getSessionForRound,
  STOCK_COUNT_ROUNDS,
  submitStockCountSession,
  subscribeStockCountSessions,
} from "@/lib/stock-count";
import type { StockCountRound, StockCountSession, StockItem } from "@/lib/types";
import {
  buildStockHistoryTimeline,
  formatStockCountTimeShort,
  inspectorShort,
  parseStockMonthInput,
  roundLabel,
  timelineRoundLabel,
  type StockHistoryItemCol,
  type StockHistoryTimelineRow,
} from "@/lib/stock-history";
import { seedStockItemsIfEmpty, subscribeStockItems } from "@/lib/stock";
import { formatDateShort, formatStockQty, parseDateInput } from "@/lib/utils";

type DraftLine = {
  itemId: string;
  itemName: string;
  qty: string;
};

export default function StockPage() {
  return (
    <AuthGate>
      <StockView />
    </AuthGate>
  );
}

function StockView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const canUseStock = can(staff, "stock");
  const [formOpen, setFormOpen] = useState(false);
  const [items, setItems] = useState<StockItem[]>([]);
  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff && !canUseStock) router.replace("/ledger/");
  }, [staff, router, canUseStock]);

  useEffect(() => {
    if (!canUseStock || !actorId) return;
    setLoading(true);
    void Promise.all([
      seedStockItemsIfEmpty(actorId),
      listActiveEmployees().then(setEmployees),
    ])
      .catch((err) => setError((err as Error).message || "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));

    const unsubItems = subscribeStockItems(
      (rows) => setItems(rows),
      (err) => setError(err.message),
    );
    const unsubSessions = subscribeStockCountSessions(
      (rows) => setSessions(rows),
      (err) => setError(err.message),
    );
    return () => {
      unsubItems();
      unsubSessions();
    };
  }, [canUseStock, actorId]);

  useBodyScrollLock(formOpen);

  if (!canUseStock) return null;

  return (
    <div className="module-page stock-module">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <Boxes size={18} aria-hidden />
          คลังวัตถุดิบ
        </h1>
        <p className="muted stock-subtitle">นับสต๊อกคงเหลือ — วันที่ 1 · 10 · 20 ของเดือน</p>
        {isOwner ? (
          <p className="stock-settings-link">
            <Link href="/settings/">
              <Settings size={13} aria-hidden /> จัดการรายการสินค้า →
            </Link>
          </p>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <StockHistoryView
          items={items}
          sessions={sessions}
          isOwner={isOwner}
          onError={setError}
        />
      ) : null}

      {formOpen && !loading ? (
        <div className="modal-backdrop edit-modal is-module-form is-stock-form" onClick={() => setFormOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <StockCountForm
              items={items}
              employees={employees}
              createdBy={actorId}
              onError={setError}
              onClose={() => setFormOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <ModuleTabDock
        ariaLabel="มุมมองคลัง"
        formOpen={formOpen}
        onAdd={() => setFormOpen(true)}
        addLabel="+ นับสต็อก"
      />
    </div>
  );
}

function StockHistoryView({
  items,
  sessions,
  isOwner,
  onError,
}: {
  items: StockItem[];
  sessions: StockCountSession[];
  isOwner: boolean;
  onError: (msg: string | null) => void;
}) {
  const [filter, setFilter] = useState<"all" | "missing">("all");
  const [detail, setDetail] = useState<StockHistoryTimelineRow | null>(null);

  useBodyScrollLock(!!detail);

  const grid = useMemo(
    () => buildStockHistoryTimeline(sessions, items),
    [sessions, items],
  );

  const rows = useMemo(
    () => (filter === "missing" ? grid.rows.filter((r) => !r.session) : grid.rows),
    [grid.rows, filter],
  );

  const stats = grid.stats;

  async function onDeleteSession(sessionId: string) {
    if (!window.confirm("ลบรอบนับนี้?")) return;
    try {
      await deleteStockCountSession(sessionId);
      setDetail(null);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  if (items.length === 0) {
    return (
      <p className="empty">
        ยังไม่มีรายการสินค้า — {isOwner ? "ไปที่ ตั้งค่า → คลังวัตถุดิบ เพื่อเพิ่มรายการ" : "รอเจ้าของตั้งค่ารายการ"}
      </p>
    );
  }

  return (
    <div className="stock-summary-view">
      <div className="check-history-toolbar stock-history-toolbar">
        <div className="check-filter-pills" role="group" aria-label="ตัวกรอง">
          <button
            type="button"
            className={filter === "all" ? "check-filter-pill is-active" : "check-filter-pill"}
            onClick={() => setFilter("all")}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            className={filter === "missing" ? "check-filter-pill is-active" : "check-filter-pill"}
            onClick={() => setFilter("missing")}
          >
            ยังไม่นับ
          </button>
        </div>
        <p className="muted check-history-stats">
          {stats.filledRounds}/{stats.totalRounds} รอบ · {stats.itemsTracked} รายการ
          {stats.rangeLabel !== "—" ? ` · ${stats.rangeLabel}` : ""}
        </p>
      </div>

      <p className="muted check-history-hint">
        ประวัติย้อนหลังทุกเดือนที่มีข้อมูล · แถว = รอบนับ (1 · 10 · 20) · แตะช่องดูรายละเอียด
      </p>

      {rows.length ? (
        <div className="sheet-wrap stock-history-wrap">
          <table className="sheet-table stock-history-table">
            <thead>
              <tr>
                <th className="stock-history-th-date">รอบ</th>
                {grid.columns.map((col) => (
                  <th key={col.itemId} className="stock-history-th-item" title={col.name}>
                    {col.shortName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <StockHistoryRow
                  key={row.rowKey}
                  row={row}
                  columns={grid.columns}
                  onOpen={() => row.session && setDetail(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          {filter === "missing"
            ? "ครบทุกรอบในช่วงนี้แล้ว"
            : "ยังไม่มีประวัติ — กด + นับสต็อก หรือนำเข้า CSV ที่ ตั้งค่า"}
        </p>
      )}

      {detail?.session ? (
        <StockCountDetailModal
          row={detail}
          columns={grid.columns}
          isOwner={isOwner}
          onClose={() => setDetail(null)}
          onDelete={() => void onDeleteSession(detail.session!.id)}
        />
      ) : null}
    </div>
  );
}

function StockHistoryRow({
  row,
  columns,
  onOpen,
}: {
  row: StockHistoryTimelineRow;
  columns: StockHistoryItemCol[];
  onOpen: () => void;
}) {
  const hasSession = !!row.session;
  const isMissing = !hasSession;

  return (
    <tr className={isMissing ? "stock-history-row-missing" : "stock-history-row-filled"}>
      <td className="stock-history-date">
        {timelineRoundLabel(row)}
        {hasSession ? (
          <span className="stock-history-meta-inline">
            {inspectorShort(row.session!.inspector)} · {formatStockCountTimeShort(row.session!.submittedAt)}
          </span>
        ) : (
          <span className="stock-history-missing-tag">ยังไม่นับ</span>
        )}
      </td>
      {columns.map((col, idx) => {
        const cell = row.cells[idx];
        const qty = cell?.qty;
        if (!hasSession) {
          return (
            <td key={col.itemId}>
              <span className="stock-history-cell is-pending">—</span>
            </td>
          );
        }
        return (
          <td key={col.itemId}>
            <button
              type="button"
              className="stock-history-cell is-filled"
              onClick={onOpen}
              title={`${col.name}: ${qty != null ? formatStockQty(qty) : "—"} ${col.unit}`}
            >
              {qty != null ? formatStockQty(qty) : "—"}
            </button>
          </td>
        );
      })}
    </tr>
  );
}

function StockCountDetailModal({
  row,
  columns,
  isOwner,
  onClose,
  onDelete,
}: {
  row: StockHistoryTimelineRow;
  columns: StockHistoryItemCol[];
  isOwner: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const session = row.session!;

  return (
    <div className="modal-backdrop edit-modal" onClick={onClose}>
      <div className="modal-card check-detail-card stock-detail-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="panel-title" style={{ fontSize: "1rem" }}>
              {timelineRoundLabel(row)} · {formatDateShort(row.dateMs)}
            </h2>
            <p className="muted check-detail-sub">
              {session.inspector} · {formatStockCountTimeShort(session.submittedAt)}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="ปิด">
            <X size={18} />
          </button>
        </div>

        <table className="sheet-table stock-detail-table">
          <thead>
            <tr>
              <th>รายการ</th>
              <th className="col-out">จำนวน</th>
              <th>หน่วย</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col) => {
              const line = session.lines.find((l) => l.itemId === col.itemId);
              return (
                <tr key={col.itemId}>
                  <td>{col.name}</td>
                  <td className="col-out">{line != null ? formatStockQty(line.qty) : "—"}</td>
                  <td>{col.unit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {isOwner ? (
          <button type="button" className="danger-btn" style={{ marginTop: "0.65rem" }} onClick={onDelete}>
            ลบรอบนับนี้
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StockCountForm({
  items,
  employees,
  createdBy,
  onError,
  onClose,
}: {
  items: StockItem[];
  employees: Employee[];
  createdBy: string;
  onError: (msg: string | null) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const defaultRound = nearestRound(now.getDate());
  const defaultDate = new Date(now.getFullYear(), now.getMonth(), defaultRound);

  const [step, setStep] = useState<"setup" | "count" | "done">("setup");
  const [year, setYear] = useState(defaultDate.getFullYear());
  const [month, setMonth] = useState(defaultDate.getMonth());
  const [dayOfMonth, setDayOfMonth] = useState<StockCountRound>(defaultRound);
  const [inspectorId, setInspectorId] = useState("");
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [existingSession, setExistingSession] = useState<StockCountSession | null>(null);
  const [busy, setBusy] = useState(false);

  const monthInput = `${year}-${String(month + 1).padStart(2, "0")}`;
  const inspector = employees.find((e) => e.id === inspectorId);

  useEffect(() => {
    if (step !== "setup") return;
    void getSessionForRound(year, month, dayOfMonth)
      .then(setExistingSession)
      .catch(() => setExistingSession(null));
  }, [step, year, month, dayOfMonth]);

  function onMonthChange(value: string) {
    const { year: y, month: m } = parseStockMonthInput(value);
    setYear(y);
    setMonth(m);
    const round = nearestRoundForMonth(y, m);
    setDayOfMonth(round);
  }

  function startCount() {
    if (!inspector) {
      onError("ต้องเลือกผู้ตรวจนับ");
      return;
    }
    onError(null);
    const fromExisting = existingSession?.lines || [];
    setDrafts(
      items.map((item) => {
        const prev = fromExisting.find((l) => l.itemId === item.id);
        return {
          itemId: item.id,
          itemName: item.name,
          qty: prev != null ? String(prev.qty) : "",
        };
      }),
    );
    setStep("count");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!inspector || !createdBy) return;
    setBusy(true);
    onError(null);
    try {
      const lines = drafts.map((d) => ({
        itemId: d.itemId,
        itemName: d.itemName,
        qty: Math.max(0, Math.round(Number(d.qty) || 0)),
      }));
      const dateMs = parseDateInput(
        `${year}-${String(month + 1).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`,
      );
      await submitStockCountSession({
        date: dateMs,
        dayOfMonth,
        year,
        month,
        inspector: inspector.name,
        inspectorId: inspector.id,
        submittedAt: Date.now(),
        createdBy,
        lines,
      });
      setStep("done");
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="check-form">
        <p className="empty">ยังไม่มีรายการสินค้า — ตั้งค่าที่ ตั้งค่าโมดูล ก่อน</p>
        <button type="button" className="ghost-btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="check-form">
        <h2 className="panel-title">บันทึกแล้ว</h2>
        <p className="muted">รอบ {roundLabel(dayOfMonth)} · {inspector?.name}</p>
        <button type="button" className="primary-btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  if (step === "setup") {
    return (
      <div className="check-form">
        <h2 className="panel-title">นับสต็อก</h2>
        <div className="field">
          <label htmlFor="stock-count-month">เดือน</label>
          <input
            id="stock-count-month"
            type="month"
            value={monthInput}
            onChange={(e) => onMonthChange(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="stock-count-round">รอบนับ</label>
          <select
            id="stock-count-round"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(Number(e.target.value) as StockCountRound)}
          >
            {STOCK_COUNT_ROUNDS.map((d) => (
              <option key={d} value={d}>
                วันที่ {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="stock-count-inspector">ผู้ตรวจนับ</label>
          <select
            id="stock-count-inspector"
            value={inspectorId}
            onChange={(e) => setInspectorId(e.target.value)}
            required
          >
            <option value="">— เลือก —</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
        {existingSession ? (
          <p className="muted check-hint">
            มีข้อมูลรอบนี้แล้ว ({existingSession.inspector}) — บันทึกใหม่จะแทนที่
          </p>
        ) : null}
        <div className="check-form-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="primary-btn" onClick={startCount}>
            ถัดไป — กรอกจำนวน
          </button>
        </div>
      </div>
    );
  }

  function clearAllToZero() {
    if (!window.confirm("เคลียร์ทุกรายการเป็น 0?")) return;
    setDrafts((prev) => prev.map((line) => ({ ...line, qty: "0" })));
  }

  return (
    <form className="check-form stock-count-form" onSubmit={(e) => void onSubmit(e)}>
      <h2 className="panel-title">
        {roundLabel(dayOfMonth)} · {inspector?.name}
      </h2>
      <div className="stock-count-form-head">
        <p className="muted check-hint">กรอกยอดคงเหลือที่นับได้ (snapshot)</p>
        <button type="button" className="ghost-btn stock-count-clear-btn" onClick={clearAllToZero}>
          เคลียร์เป็น 0
        </button>
      </div>

      <div className="stock-count-lines">
        {drafts.map((line, idx) => {
          const item = items.find((i) => i.id === line.itemId);
          return (
            <label key={line.itemId} className="stock-count-line">
              <span className="stock-count-line-name">{line.itemName}</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={line.qty}
                onChange={(e) => {
                  const next = [...drafts];
                  next[idx] = { ...line, qty: e.target.value };
                  setDrafts(next);
                }}
                placeholder="0"
                aria-label={`จำนวน ${line.itemName}`}
              />
              <span className="muted stock-count-line-unit">{item?.unit || ""}</span>
            </label>
          );
        })}
      </div>

      <div className="check-form-actions">
        <button type="button" className="ghost-btn" onClick={() => setStep("setup")}>ย้อนกลับ</button>
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </form>
  );
}

function nearestRound(day: number): StockCountRound {
  if (day <= 1) return 1;
  if (day <= 10) return 10;
  return 20;
}

function nearestRoundForMonth(year: number, month: number): StockCountRound {
  const today = new Date();
  if (today.getFullYear() !== year || today.getMonth() !== month) {
    return 1;
  }
  return nearestRound(today.getDate());
}
