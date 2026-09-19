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
import { Boxes, Plus, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
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
  roundLabel,
  stockRoundDateLabelBe,
  timelineRoundLabel,
  type StockHistoryItemCol,
  type StockHistoryTimelineRow,
} from "@/lib/stock-history";
import {
  guessStockIconId,
  stockIconComponent,
} from "@/lib/stock-icons";
import {
  createStockItem,
  deleteStockItem,
  seedStockItemsIfEmpty,
  subscribeStockItems,
  updateStockItem,
} from "@/lib/stock";
import { formatStockQty, parseDateInput } from "@/lib/utils";

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
  const [policyOpen, setPolicyOpen] = useState(false);

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

  useEffect(() => {
    if (loading || !canUseStock) return;
    setPolicyOpen(true);
  }, [loading, canUseStock]);

  useBodyScrollLock(!!countTarget || policyOpen);

  if (!canUseStock) return null;

  return (
    <div className="module-page stock-module stock-page">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <Boxes size={18} aria-hidden />
          คลังวัตถุดิบ
        </h1>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <StockHistoryView
          items={items}
          sessions={sessions}
          isOwner={isOwner}
          actorId={actorId}
          onError={setError}
          onCountRound={(row) =>
            setCountTarget({
              year: row.year,
              month: row.month,
              dayOfMonth: row.dayOfMonth,
            })
          }
        />
      ) : null}

      {countTarget && !loading ? (
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
            />
          </div>
        </div>
      ) : null}

      {policyOpen ? (
        <div
          className="modal-backdrop alert-backdrop stock-fifo-policy-backdrop"
          role="presentation"
        >
          <div
            className="modal-card stock-fifo-policy-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-fifo-policy-title"
          >
            <p className="stock-fifo-policy-kicker">นโยบายคลัง</p>
            <h2 id="stock-fifo-policy-title" className="stock-fifo-policy-title">
              สินค้าเข้าก่อน → ให้นำมาใช้ก่อน
            </h2>
            <p className="stock-fifo-policy-reason">
              เพราะสินค้าอาจเน่าเสีย / หมดอายุได้
            </p>
            <button
              type="button"
              className="primary-btn stock-fifo-policy-ok"
              onClick={() => setPolicyOpen(false)}
            >
              ยอมรับ
            </button>
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
  actorId,
  onError,
  onCountRound,
}: {
  items: StockItem[];
  sessions: StockCountSession[];
  isOwner: boolean;
  actorId: string;
  onError: (msg: string | null) => void;
  onCountRound: (row: StockHistoryTimelineRow) => void;
}) {
  const [filter, setFilter] = useState<"all" | "missing">("all");
  const [detail, setDetail] = useState<StockHistoryTimelineRow | null>(null);
  /** null = closed · "new" = เพิ่ม · string = แก้ itemId */
  const [editTarget, setEditTarget] = useState<"new" | string | null>(null);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);

  useBodyScrollLock(!!detail || !!editTarget);

  const grid = useMemo(
    () => buildStockHistoryTimeline(sessions, items),
    [sessions, items],
  );

  const rows = useMemo(
    () => (filter === "missing" ? grid.rows.filter((r) => !r.session) : grid.rows),
    [grid.rows, filter],
  );

  const stats = grid.stats;
  const editingItem =
    editTarget && editTarget !== "new"
      ? items.find((i) => i.id === editTarget) || null
      : null;

  async function confirmDeleteSession() {
    if (!confirmDeleteSessionId) return;
    setDeletingSession(true);
    onError(null);
    try {
      await deleteStockCountSession(confirmDeleteSessionId);
      setConfirmDeleteSessionId(null);
      setDetail(null);
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setDeletingSession(false);
    }
  }

  return (
    <div className="stock-summary-view">
      <div className="check-history-toolbar stock-history-toolbar ot-toolbar-slim module-toolbar-slim">
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
      </div>

      {items.length === 0 && !isOwner ? (
        <p className="empty">ยังไม่มีรายการสินค้า — รอเจ้าของเพิ่ม</p>
      ) : (
        <>
          <div className="sheet-wrap stock-history-wrap stock-history-sheet sheet-bleed">
            <table className="sheet-table stock-history-table stock-history-table--items-rows sheet-table--dense">
              <thead>
                <tr>
                  <th className="stock-history-th-item stock-history-th-sticky">วัตถุดิบ</th>
                  <th className="stock-history-th-note">โน้ต</th>
                  {rows.map((row) => (
                    <th
                      key={row.rowKey}
                      className={
                        row.session
                          ? "stock-history-th-date is-filled"
                          : "stock-history-th-date is-missing"
                      }
                      title={
                        row.session
                          ? `${timelineRoundLabel(row)} · ${row.session.inspector}`
                          : `${timelineRoundLabel(row)} · ยังไม่นับ`
                      }
                    >
                      <button
                        type="button"
                        className="stock-history-date-head-btn"
                        onClick={() =>
                          row.session ? setDetail(row) : onCountRound(row)
                        }
                      >
                        <span className="stock-history-date-head-label">
                          {timelineRoundLabel(row)}
                        </span>
                        {!row.session ? (
                          <span className="stock-history-missing-tag">ยังไม่นับ</span>
                        ) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.columns.map((col) => (
                  <StockHistoryItemRow
                    key={col.itemId}
                    col={col}
                    rounds={rows}
                    isOwner={isOwner}
                    actorId={actorId}
                    onCountRound={onCountRound}
                    onOpenFilled={(row) => setDetail(row)}
                    onOpenSettings={() => setEditTarget(col.itemId)}
                    onError={onError}
                  />
                ))}
              </tbody>
            </table>
            {filter === "missing" && rows.length === 0 && items.length > 0 ? (
              <p className="empty">ครบทุกรอบในช่วงนี้แล้ว</p>
            ) : null}
          </div>

          {isOwner ? (
            <div className="stock-history-add-bar">
              <button
                type="button"
                className="stock-history-add-btn"
                onClick={() => setEditTarget("new")}
                aria-label="เพิ่มวัตถุดิบ"
              >
                <Plus size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="stock-history-add-link"
                onClick={() => setEditTarget("new")}
              >
                + เพิ่มรายการ
              </button>
            </div>
          ) : null}
        </>
      )}

      {editTarget && isOwner ? (
        <StockItemSlimModal
          mode={editTarget === "new" ? "new" : "edit"}
          item={editingItem}
          actorId={actorId}
          onClose={() => setEditTarget(null)}
          onError={onError}
        />
      ) : null}

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
          onDelete={() => setConfirmDeleteSessionId(detail.session!.id)}
        />
      ) : null}

      <PosConfirmDialog
        open={!!confirmDeleteSessionId}
        title="ลบรอบนับนี้?"
        message="ลบแล้วกู้คืนไม่ได้ — ยืนยันอีกครั้ง"
        destructive
        confirmLabel="ลบ"
        busy={deletingSession}
        onCancel={() => {
          if (deletingSession) return;
          setConfirmDeleteSessionId(null);
        }}
        onConfirm={() => void confirmDeleteSession()}
      />
    </div>
  );
}

function StockItemSlimModal({
  mode,
  item,
  actorId,
  onClose,
  onError,
}: {
  mode: "new" | "edit";
  item: StockItem | null;
  actorId: string;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(item?.name || "");
  const [minQty, setMinQty] = useState(String(item?.minQty ?? 0));
  const [alertEnabled, setAlertEnabled] = useState(item?.alertEnabled === true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const iconId = guessStockIconId(name.trim() || item?.name || "");
  const Icon = stockIconComponent(iconId);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !actorId) return;
    setBusy(true);
    onError(null);
    try {
      const icon = guessStockIconId(trimmed);
      if (mode === "new") {
        await createStockItem({
          name: trimmed,
          unit: "ชิ้น",
          qty: 0,
          minQty: Number(minQty) || 0,
          alertEnabled,
          safetyStock: 0,
          unitCost: 0,
          icon,
          updatedBy: actorId,
        });
      } else if (item) {
        await updateStockItem(item.id, {
          name: trimmed,
          minQty: Number(minQty) || 0,
          alertEnabled,
          icon,
          updatedBy: actorId,
        });
      }
      onClose();
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteConfirmed() {
    if (!item) return;
    setBusy(true);
    onError(null);
    try {
      await deleteStockItem(item.id);
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div
      className="modal-backdrop edit-modal is-stock-item-slim"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-card stock-item-slim-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-item-slim-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stock-item-slim-head">
          <h2 id="stock-item-slim-title" className="stock-item-slim-title">
            {mode === "new" ? "เพิ่มวัตถุดิบ" : "ตั้งค่ารายการ"}
          </h2>
          <button type="button" className="ghost-btn icon-btn" aria-label="ปิด" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <form className="stock-item-slim-form" onSubmit={(e) => void onSave(e)}>
          <label className="stock-item-slim-field">
            <span>ชื่อ</span>
            <span className="stock-item-slim-name-wrap">
              <Icon size={15} aria-hidden className="stock-item-slim-icon-preview" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ชื่อวัตถุดิบ"
                required
                autoFocus
                autoComplete="off"
              />
            </span>
          </label>
          <label className="stock-item-slim-field">
            <span>แจ้งเตือน</span>
            <span className="stock-item-slim-min-wrap">
              <span className="stock-item-slim-min-prefix" aria-hidden>
                ≤
              </span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
              />
            </span>
          </label>
          <label className="check-row stock-item-slim-alert-check">
            <input
              type="checkbox"
              checked={alertEnabled}
              onChange={(e) => setAlertEnabled(e.target.checked)}
            />
            <span>เปิดแจ้งเตือน LINE เมื่อคงเหลือ ≤ เกณฑ์</span>
          </label>
          <div className="stock-item-slim-actions">
            {mode === "edit" ? (
              <button
                type="button"
                className="ghost-btn stock-item-slim-del"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={12} aria-hidden />
                ลบ
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="primary-btn" disabled={busy || !name.trim()}>
              {busy ? "…" : "บันทึก"}
            </button>
          </div>
        </form>
      </div>
    </div>
    <PosConfirmDialog
      open={confirmDelete}
      title="ลบรายการนี้?"
      message={item ? `ลบ「${item.name}」แล้วกู้คืนไม่ได้` : "ลบแล้วกู้คืนไม่ได้"}
      destructive
      confirmLabel="ลบ"
      busy={busy}
      onCancel={() => {
        if (busy) return;
        setConfirmDelete(false);
      }}
      onConfirm={() => void onDeleteConfirmed()}
    />
    </>
  );
}

function StockHistoryItemRow({
  col,
  rounds,
  isOwner,
  actorId,
  onCountRound,
  onOpenFilled,
  onOpenSettings,
  onError,
}: {
  col: StockHistoryItemCol;
  rounds: StockHistoryTimelineRow[];
  isOwner: boolean;
  actorId: string;
  onCountRound: (row: StockHistoryTimelineRow) => void;
  onOpenFilled: (row: StockHistoryTimelineRow) => void;
  onOpenSettings: () => void;
  onError: (msg: string | null) => void;
}) {
  const iconId = guessStockIconId(col.name);
  const Icon = stockIconComponent(iconId);
  const iconClass =
    iconId === "straw"
      ? "stock-history-item-icon is-straw"
      : iconId === "lid"
        ? "stock-history-item-icon is-lid"
        : iconId === "powder"
          ? "stock-history-item-icon is-powder"
          : "stock-history-item-icon";
  const low = col.minQty > 0 && col.qty <= col.minQty;
  const [noteDraft, setNoteDraft] = useState(col.note || "");
  const noteDraftRef = useRef(noteDraft);
  const noteFocusedRef = useRef(false);
  noteDraftRef.current = noteDraft;

  useEffect(() => {
    if (noteFocusedRef.current) return;
    setNoteDraft(col.note || "");
  }, [col.itemId, col.note]);

  const saveNote = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      const prev = (col.note || "").trim();
      if (trimmed === prev) return;
      if (!actorId) return;
      onError(null);
      try {
        await updateStockItem(col.itemId, { note: trimmed, updatedBy: actorId });
      } catch (err) {
        onError((err as Error).message || "บันทึกโน้ตไม่สำเร็จ");
        setNoteDraft(col.note || "");
      }
    },
    [actorId, col.itemId, col.note, onError],
  );

  // พิมพ์แล้วบันทึกอัตโนมัติ (debounce) — ไม่ต้องกดปุ่ม
  useEffect(() => {
    const trimmed = noteDraft.trim();
    const prev = (col.note || "").trim();
    if (trimmed === prev) return;
    if (!actorId) return;
    const t = window.setTimeout(() => {
      void saveNote(noteDraftRef.current);
    }, 450);
    return () => window.clearTimeout(t);
  }, [noteDraft, col.note, actorId, saveNote]);

  return (
    <tr className={low ? "stock-history-item-row is-low" : "stock-history-item-row"}>
      <th scope="row" className="stock-history-item-cell stock-history-th-sticky">
        {isOwner ? (
          <button
            type="button"
            className="stock-history-item-main is-tappable"
            onClick={onOpenSettings}
            title="เปิดตั้งค่า"
          >
            <Icon size={13} aria-hidden className={iconClass} />
            <span className="stock-history-item-name">{col.name}</span>
            {low ? (
              <span className="stock-history-low-badge" title={`คงเหลือ ${col.qty} ≤ ${col.minQty}`}>
                ≤{col.minQty}
              </span>
            ) : col.minQty > 0 ? (
              <span className="stock-history-min-tag">≤{col.minQty}</span>
            ) : null}
          </button>
        ) : (
          <span className="stock-history-item-main" title={col.name}>
            <Icon size={13} aria-hidden className={iconClass} />
            <span className="stock-history-item-name">{col.name}</span>
            {low ? (
              <span className="stock-history-low-badge" title={`คงเหลือ ${col.qty} ≤ ${col.minQty}`}>
                ≤{col.minQty}
              </span>
            ) : null}
          </span>
        )}
      </th>
      <td className="stock-history-note-cell">
        <input
          className="stock-history-note-input"
          value={noteDraft}
          placeholder=""
          aria-label={`โน้ต ${col.name}`}
          onChange={(e) => setNoteDraft(e.target.value)}
          onFocus={() => {
            noteFocusedRef.current = true;
          }}
          onBlur={() => {
            noteFocusedRef.current = false;
            void saveNote(noteDraft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
        />
      </td>
      {rounds.map((row) => {
        const cell = row.cells.find((c) => c.itemId === col.itemId);
        const qty = cell?.qty ?? null;
        const hasSession = !!row.session;
        const cellLow = hasSession && qty != null && col.minQty > 0 && qty <= col.minQty;
        if (!hasSession) {
          return (
            <td key={row.rowKey}>
              <button
                type="button"
                className="stock-history-cell is-pending"
                onClick={() => onCountRound(row)}
                title={`กรอกนับรอบ ${timelineRoundLabel(row)}`}
              >
                —
              </button>
            </td>
          );
        }
        return (
          <td key={row.rowKey}>
            <button
              type="button"
              className={
                cellLow
                  ? "stock-history-cell is-filled is-low"
                  : "stock-history-cell is-filled"
              }
              onClick={() => onCountRound(row)}
              onContextMenu={(e) => {
                e.preventDefault();
                onOpenFilled(row);
              }}
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
}: {
  items: StockItem[];
  employees: Employee[];
  createdBy: string;
  isOwner: boolean;
  /** System round only — no free month/round picker. */
  lockedRound: { year: number; month: number; dayOfMonth: StockCountRound };
  onError: (msg: string | null) => void;
  onClose: () => void;
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
          {isOwner
            ? "ยังไม่มีรายการสินค้า — ปิดแล้วพิมพ์ชื่อที่แถว + ด้านล่างตาราง"
            : "ยังไม่มีรายการสินค้า — รอเจ้าของเพิ่ม"}
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

