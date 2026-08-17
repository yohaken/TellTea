"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Boxes, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { StockCatalogSetup } from "@/components/StockCatalogSetup";
import { useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { listActiveEmployees, type Employee } from "@/lib/employees";
import { can } from "@/lib/permissions";
import { staffHomeHref } from "@/lib/nav-menu";
import {
  deleteStockCountSession,
  getSessionForRound,
  submitStockCountSession,
  stockCountSinceMs,
  subscribeStockCountSessions,
} from "@/lib/stock-count";
import type { StockCountRound, StockCountSession, StockItem } from "@/lib/types";
import {
  buildStockHistoryTimeline,
  formatStockCountTimeShort,
  inspectorShort,
  roundLabel,
  stockRoundDateLabelBe,
  timelineRoundLabel,
  type StockHistoryItemCol,
  type StockHistoryTimelineRow,
} from "@/lib/stock-history";
import { seedStockItemsIfEmpty, subscribeStockItems } from "@/lib/stock";
import { formatStockQty, parseDateInput } from "@/lib/utils";

type DraftLine = {
  itemId: string;
  itemName: string;
  qty: string;
};

type StockOwnerView = "history" | "catalog";

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
  const [ownerView, setOwnerView] = useState<StockOwnerView>("history");
  const [countTarget, setCountTarget] = useState<{
    year: number;
    month: number;
    dayOfMonth: StockCountRound;
  } | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff && !canUseStock) router.replace(staffHomeHref(staff));
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
      { since: stockCountSinceMs() },
    );
    return () => {
      unsubItems();
      unsubSessions();
    };
  }, [canUseStock, actorId]);

  useBodyScrollLock(!!countTarget);

  if (!canUseStock) return null;

  const showCatalog = isOwner && ownerView === "catalog";
  const showHistory = !showCatalog;

  const ownerTabs = isOwner ? (
    <div className="stock-owner-tabs stock-owner-tabs--inline" role="tablist" aria-label="มุมมองคลังเจ้าของ">
      <button
        type="button"
        role="tab"
        className={ownerView === "history" ? "stock-owner-tab is-active" : "stock-owner-tab"}
        aria-selected={ownerView === "history"}
        onClick={() => {
          setOwnerView("history");
          setCountTarget(null);
        }}
      >
        ประวัตินับ
      </button>
      <button
        type="button"
        role="tab"
        className={ownerView === "catalog" ? "stock-owner-tab is-active" : "stock-owner-tab"}
        aria-selected={ownerView === "catalog"}
        onClick={() => {
          setOwnerView("catalog");
          setCountTarget(null);
        }}
      >
        รายการวัตถุดิบ
        {items.length ? ` (${items.length})` : ""}
      </button>
    </div>
  ) : null;

  return (
    <div className="module-page stock-module stock-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <Boxes size={18} aria-hidden />
          คลังวัตถุดิบ
        </h1>
        <p className="muted stock-subtitle">
          {showCatalog
            ? "จัดการรายการ — ตั้งชื่อ · เพิ่ม/ลด · ลบ (เจ้าของ)"
            : "นับสต๊อกคงเหลือ — ระบบเปิดรอบ 1 · 10 · 20 ล่วงหน้า 3 รอบ · เรียงใหม่→เก่า"}
        </p>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && showCatalog ? (
        <>
          {ownerTabs ? (
            <div className="ot-toolbar-slim module-toolbar-slim">{ownerTabs}</div>
          ) : null}
          <StockCatalogSetup onError={setError} />
        </>
      ) : null}

      {!loading && showHistory ? (
        <StockHistoryView
          items={items}
          sessions={sessions}
          isOwner={isOwner}
          onError={setError}
          onOpenCatalog={isOwner ? () => setOwnerView("catalog") : undefined}
          onCountRound={(row) =>
            setCountTarget({
              year: row.year,
              month: row.month,
              dayOfMonth: row.dayOfMonth,
            })
          }
          toolbarLeading={ownerTabs}
        />
      ) : null}

      {countTarget && !loading && showHistory ? (
        <div
          className="modal-backdrop edit-modal is-module-form is-stock-form"
          onClick={() => setCountTarget(null)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <StockCountForm
              items={items}
              employees={employees}
              createdBy={actorId}
              isOwner={isOwner}
              lockedRound={countTarget}
              onError={setError}
              onClose={() => setCountTarget(null)}
              onOpenCatalog={isOwner ? () => setOwnerView("catalog") : undefined}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StockHistoryView({
  items,
  sessions,
  isOwner,
  onError,
  onOpenCatalog,
  onCountRound,
  toolbarLeading,
}: {
  items: StockItem[];
  sessions: StockCountSession[];
  isOwner: boolean;
  onError: (msg: string | null) => void;
  onOpenCatalog?: () => void;
  onCountRound: (row: StockHistoryTimelineRow) => void;
  toolbarLeading?: ReactNode;
}) {
  const [filter, setFilter] = useState<"all" | "missing">("all");
  const [detail, setDetail] = useState<StockHistoryTimelineRow | null>(null);

  useBodyScrollLock(!!detail);

  const grid = useMemo(
    () => buildStockHistoryTimeline(sessions, items),
    [sessions, items],
  );

  // Preserve newest → oldest from timeline builder.
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
        ยังไม่มีรายการสินค้า —{" "}
        {isOwner && onOpenCatalog ? (
          <button type="button" className="linkish-btn" onClick={onOpenCatalog}>
            ไปเพิ่มที่แท็บรายการวัตถุดิบ
          </button>
        ) : (
          "รอเจ้าของตั้งค่ารายการ"
        )}
      </p>
    );
  }

  return (
    <div className="stock-summary-view">
      <div className="check-history-toolbar stock-history-toolbar ot-toolbar-slim module-toolbar-slim">
        {toolbarLeading}
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
        <p className="muted check-history-stats module-slim-stats">
          {stats.filledRounds}/{stats.totalRounds} รอบ · {stats.itemsTracked} รายการ
          {stats.rangeLabel !== "—" ? ` · ${stats.rangeLabel}` : ""}
        </p>
        <span
          className="ot-slim-hint muted module-slim-hint"
          title="เรียงวันที่ใหม่→เก่า · ระบบเปิดรอบล่วงหน้า 3 รอบ · แตะแถวว่างเพื่อนับ · แตะช่องที่นับแล้วเพื่อแก้ไข"
        >
          ใหม่→เก่า · แตะเพื่อนับ/แก้
        </span>
      </div>

      {rows.length ? (
        <div className="sheet-wrap stock-history-wrap stock-history-sheet sheet-bleed">
          <table className="sheet-table stock-history-table sheet-table--dense">
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
                  onOpenDetail={() => row.session && setDetail(row)}
                  onEditFilled={() => onCountRound(row)}
                  onCountMissing={() => onCountRound(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          {filter === "missing"
            ? "ครบทุกรอบในช่วงนี้แล้ว"
            : "ยังไม่มีรอบนับ — ระบบจะเปิดรอบ 1 · 10 · 20 ให้อัตโนมัติ"}
        </p>
      )}

      {detail?.session ? (
        <StockCountDetailModal
          row={detail}
          columns={grid.columns}
          isOwner={isOwner}
          onClose={() => setDetail(null)}
          onEdit={() => {
            const target = detail;
            setDetail(null);
            onCountRound(target);
          }}
          onDelete={() => void onDeleteSession(detail.session!.id)}
        />
      ) : null}
    </div>
  );
}

function StockHistoryRow({
  row,
  columns,
  onOpenDetail,
  onEditFilled,
  onCountMissing,
}: {
  row: StockHistoryTimelineRow;
  columns: StockHistoryItemCol[];
  onOpenDetail: () => void;
  onEditFilled: () => void;
  onCountMissing: () => void;
}) {
  const hasSession = !!row.session;
  const isMissing = !hasSession;

  return (
    <tr className={isMissing ? "stock-history-row-missing" : "stock-history-row-filled"}>
      <td className="stock-history-date">
        {isMissing ? (
          <button
            type="button"
            className="stock-history-round-btn"
            onClick={onCountMissing}
            title={`กรอกนับรอบ ${timelineRoundLabel(row)}`}
          >
            {timelineRoundLabel(row)}
            <span className="stock-history-missing-tag">ยังไม่นับ</span>
          </button>
        ) : (
          <button
            type="button"
            className="stock-history-round-btn is-filled"
            onClick={onOpenDetail}
            title={`ดูรายละเอียดรอบ ${timelineRoundLabel(row)}`}
          >
            {timelineRoundLabel(row)}
            <span className="stock-history-meta-inline">
              {inspectorShort(row.session!.inspector)} ·{" "}
              {formatStockCountTimeShort(row.session!.submittedAt)}
            </span>
          </button>
        )}
      </td>
      {columns.map((col, idx) => {
        const cell = row.cells[idx];
        const qty = cell?.qty;
        if (!hasSession) {
          return (
            <td key={col.itemId}>
              <button
                type="button"
                className="stock-history-cell is-pending"
                onClick={onCountMissing}
                title={`กรอกนับรอบ ${timelineRoundLabel(row)}`}
              >
                —
              </button>
            </td>
          );
        }
        return (
          <td key={col.itemId}>
            <button
              type="button"
              className="stock-history-cell is-filled"
              onClick={onEditFilled}
              title={`แก้ไข ${col.name}: ${qty != null ? formatStockQty(qty) : "—"} ${col.unit}`}
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
  onEdit,
  onDelete,
}: {
  row: StockHistoryTimelineRow;
  columns: StockHistoryItemCol[];
  isOwner: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const session = row.session!;

  return (
    <div className="modal-backdrop edit-modal" onClick={onClose}>
      <div className="modal-card check-detail-card stock-detail-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="panel-title" style={{ fontSize: "1rem" }}>
              {timelineRoundLabel(row)}
            </h2>
            <p className="muted check-detail-sub">
              {session.inspector} · {formatStockCountTimeShort(session.submittedAt)}
              {session.updatedAt && session.updatedAt !== session.submittedAt
                ? ` · แก้ล่าสุด ${formatStockCountTimeShort(session.updatedAt)}`
                : ""}
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

        <div className="check-form-actions" style={{ marginTop: "0.65rem" }}>
          <button type="button" className="primary-btn" onClick={onEdit}>
            แก้ไขยอด
          </button>
          {isOwner ? (
            <button type="button" className="danger-btn" onClick={onDelete}>
              ลบรอบนับนี้
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function buildCountDrafts(
  items: StockItem[],
  existing: StockCountSession | null,
): DraftLine[] {
  const fromExisting = existing?.lines || [];
  return items.map((item) => {
    const prev = fromExisting.find((l) => l.itemId === item.id);
    return {
      itemId: item.id,
      itemName: item.name,
      qty: prev != null ? String(prev.qty) : "",
    };
  });
}

function StockCountForm({
  items,
  employees,
  createdBy,
  isOwner,
  lockedRound,
  onError,
  onClose,
  onOpenCatalog,
}: {
  items: StockItem[];
  employees: Employee[];
  createdBy: string;
  isOwner: boolean;
  /** System round only — no free month/round picker. */
  lockedRound: { year: number; month: number; dayOfMonth: StockCountRound };
  onError: (msg: string | null) => void;
  onClose: () => void;
  onOpenCatalog?: () => void;
}) {
  const { year, month, dayOfMonth } = lockedRound;
  const [step, setStep] = useState<"setup" | "count" | "done" | "loading">("loading");
  const [inspectorId, setInspectorId] = useState("");
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [existingSession, setExistingSession] = useState<StockCountSession | null>(null);
  const [busy, setBusy] = useState(false);
  const bootedRef = useRef(false);

  const inspector = employees.find((e) => e.id === inspectorId);
  const roundDateLabel = stockRoundDateLabelBe(year, month, dayOfMonth);
  const isEdit = !!existingSession;

  // โหลดรอบเดิมครั้งเดียว — ถ้านับแล้วให้เข้าโหมดแก้จำนวนทันที (ไม่ต้องลบรอบ)
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void getSessionForRound(year, month, dayOfMonth)
      .then((session) => {
        setExistingSession(session);
        if (session) {
          const prefId =
            (session.inspectorId &&
              employees.some((e) => e.id === session.inspectorId) &&
              session.inspectorId) ||
            employees.find((e) => e.name === session.inspector)?.id ||
            "";
          setInspectorId(prefId);
          setDrafts(buildCountDrafts(items, session));
          setStep(prefId ? "count" : "setup");
        } else {
          setStep("setup");
        }
      })
      .catch(() => {
        setExistingSession(null);
        setStep("setup");
      });
  }, [year, month, dayOfMonth, items, employees]);

  function startCount() {
    if (!inspector) {
      onError("ต้องเลือกผู้ตรวจนับ");
      return;
    }
    onError(null);
    setDrafts(buildCountDrafts(items, existingSession));
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
        <p className="empty">
          ยังไม่มีรายการสินค้า —{" "}
          {isOwner && onOpenCatalog ? (
            <button
              type="button"
              className="linkish-btn"
              onClick={() => {
                onClose();
                onOpenCatalog();
              }}
            >
              ไปเพิ่มที่แท็บรายการวัตถุดิบ
            </button>
          ) : (
            "รอเจ้าของตั้งค่ารายการ"
          )}
        </p>
        <button type="button" className="ghost-btn" onClick={onClose}>
          ปิด
        </button>
      </div>
    );
  }

  if (step === "loading") {
    return (
      <div className="check-form">
        <p className="empty">กำลังโหลดรอบนับ...</p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="check-form">
        <h2 className="panel-title">{isEdit ? "อัปเดตแล้ว" : "บันทึกแล้ว"}</h2>
        <p className="muted">
          รอบ {roundDateLabel} · {inspector?.name}
        </p>
        <button type="button" className="primary-btn" onClick={onClose}>
          ปิด
        </button>
      </div>
    );
  }

  if (step === "setup") {
    return (
      <div className="check-form">
        <h2 className="panel-title">{isEdit ? "แก้ไขนับสต็อก" : "นับสต็อก"}</h2>
        <p className="muted check-hint">
          รอบที่ระบบเปิดไว้ · <strong>{roundDateLabel}</strong> ({roundLabel(dayOfMonth)})
        </p>
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
            มียอดรอบนี้แล้ว ({existingSession.inspector}) — แก้ตัวเลขแล้วบันทึกทับได้ ไม่ต้องลบรอบ
          </p>
        ) : null}
        <div className="check-form-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="primary-btn" onClick={startCount}>
            {isEdit ? "ถัดไป — แก้จำนวน" : "ถัดไป — กรอกจำนวน"}
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
        {isEdit ? "แก้ไข · " : ""}
        {roundDateLabel} · {inspector?.name}
      </h2>
      <div className="stock-count-form-head">
        <p className="muted check-hint">
          {isEdit
            ? "แก้เฉพาะรายการที่ผิด แล้วกดบันทึก — ไม่ต้องลบรอบแล้วกรอกใหม่"
            : "กรอกยอดคงเหลือที่นับได้ (snapshot)"}
        </p>
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
        <button type="button" className="ghost-btn" onClick={() => setStep("setup")}>
          ย้อนกลับ
        </button>
        <button type="submit" className="primary-btn" disabled={busy || !inspector}>
          {busy ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึก"}
        </button>
      </div>
    </form>
  );
}

