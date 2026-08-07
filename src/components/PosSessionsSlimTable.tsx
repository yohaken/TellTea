"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import {
  HEARTBEAT_INTERVAL_PRESETS,
  clampHeartbeatIntervalSec,
  getHeartbeatIntervalSec,
  setHeartbeatIntervalSec,
} from "@/lib/pos-tablet-sync";
import {
  NPOS_SHOP_KEEP_PAIRING_CODE,
  posDeviceLabel,
  posPairingCodeFromId,
  subscribePosDevicesAdmin,
  type PosDevice,
} from "@/lib/pos-devices";
import { deletePosSessionsAdmin } from "@/lib/pos-sales-admin";
import {
  POS_SESSIONS_SLIM_LIMIT,
  formatPosSessionDuration,
  posSessionCloserLabel,
  posSessionCode,
  posSessionDurationMs,
  salesForSession,
  voidedForSession,
} from "@/lib/pos-sales-report";
import {
  CASH_IN_NPOS_REMIT_ONLY,
  MANUAL_POS_DEVICE_ID,
  clearPosSessionRemitHandoff,
  createManualPosSession,
  deriveRemitStatus,
  labelRemitStatus,
  recordPosSessionRemitHandoff,
  type PosRemitStatus,
} from "@/lib/pos-session-remit";
import type { PosSale, PosSession, PosSessionCashDropNote } from "@/lib/types";
import { formatPlainNumber, startOfLocalDay, todayInputValue } from "@/lib/utils";

function formatHm(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(ts: number): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
  }).format(new Date(ts));
}

function moneyOrDash(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.0001) return "0";
  return formatPlainNumber(n);
}

type RowModel = {
  session: PosSession;
  deviceLabel: string;
  pairingCode: string;
  sessionCode: string;
  open: boolean;
  dateLabel: string;
  durationLabel: string;
  total: number;
  bills: number;
  voids: number;
  cash: number;
  transfer: number;
  pp: number;
  opening: number | undefined;
  counted: number | undefined;
  expected: number | undefined;
  diff: number | undefined;
  leave: number | undefined;
  cashOut: number | undefined;
  cashIn: number | undefined;
  cashDrops: number | undefined;
  note: string;
  openedBy: string;
  closedBy: string;
  discrepancyLabel: string;
  remit: number | undefined;
  remitStatus: PosRemitStatus | undefined;
  remitHanded: number | undefined;
  discount: number | undefined;
  cashBills: number | undefined;
  ppBills: number | undefined;
  transferBills: number | undefined;
  dropNotes: PosSessionCashDropNote[];
  isManual: boolean;
  searchBlob: string;
};

function buildRows(
  sessions: PosSession[],
  sales: PosSale[],
  devicesById: Map<string, PosDevice>,
  nowMs: number,
): RowModel[] {
  return sessions.map((session) => {
    const open = session.status === "open";
    const active = salesForSession(sales, session.id);
    const voided = voidedForSession(sales, session.id);
    const cashSum = active
      .filter((s) => s.paymentMethod === "cash")
      .reduce((a, s) => a + s.total, 0);
    const transferSum = active
      .filter((s) => s.paymentMethod === "transfer")
      .reduce((a, s) => a + s.total, 0);
    const ppSum = active
      .filter((s) => s.paymentMethod === "promptpay")
      .reduce((a, s) => a + s.total, 0);
    const salesTotal = active.reduce((a, s) => a + s.total, 0);
    const isManual =
      session.source === "manual" || session.deviceId === MANUAL_POS_DEVICE_ID;
    const device = devicesById.get(session.deviceId);
    const pairing = isManual
      ? "มือ"
      : device?.pairingCode ||
        (session.deviceId ? posPairingCodeFromId(session.deviceId) : "—");
    const dayMs = session.date || session.openedAt || 0;
    const total = open ? salesTotal || session.totalSales || 0 : session.totalSales || salesTotal || 0;
    const bills = open ? active.length || session.saleCount || 0 : session.saleCount || active.length || 0;
    const cash = open ? cashSum || session.cashTotal || 0 : session.cashTotal ?? cashSum;
    const transfer = open
      ? transferSum || session.transferTotal || 0
      : session.transferTotal ?? transferSum;
    const pp = open ? ppSum || session.promptpayTotal || 0 : session.promptpayTotal ?? ppSum;
    const deviceLabel = isManual
      ? (session.counterLabel || "รอบมือ").trim()
      : device
        ? posDeviceLabel(device)
        : session.deviceId
          ? `#${session.deviceId.slice(-4).toUpperCase()}`
          : "—";
    const sessionCode = posSessionCode(session.id);
    const dateLabel = formatDateShort(dayMs);
    const note = session.discrepancyNote || "";
    const openedBy = (session.openedByName || "").trim();
    const closedBy = posSessionCloserLabel(session);
    const discrepancyLabel = (session.discrepancyLabel || "").trim();
    const dropNotes = session.cashDropNotes || [];
    const remit =
      session.remitAmount != null
        ? session.remitAmount
        : session.closingCashCounted != null && session.leaveFloat != null
          ? Math.max(0, session.closingCashCounted - session.leaveFloat)
          : undefined;
    const remitStatus = deriveRemitStatus(session);
    return {
      session,
      deviceLabel,
      pairingCode: pairing,
      sessionCode,
      open,
      dateLabel,
      durationLabel: formatPosSessionDuration(posSessionDurationMs(session, nowMs)),
      total,
      bills,
      voids: voided.length || session.voidedCount || 0,
      cash,
      transfer,
      pp,
      opening: session.openingCash,
      counted: session.closingCashCounted,
      expected: session.expectedCash,
      diff: session.cashDifference,
      leave: session.leaveFloat,
      cashOut: session.cashOutTotal,
      cashIn: session.cashInTotal,
      cashDrops: session.cashDropCount,
      note,
      openedBy,
      closedBy,
      discrepancyLabel,
      remit,
      remitStatus,
      remitHanded: session.remitHandedAmount,
      discount: session.discountTotal,
      cashBills: session.cashBillCount,
      ppBills: session.promptpayBillCount,
      transferBills: session.transferBillCount,
      dropNotes,
      isManual,
      searchBlob: [
        pairing,
        sessionCode,
        deviceLabel,
        session.deviceId,
        session.id,
        dateLabel,
        open ? "เปิด" : "ปิด",
        note,
        openedBy,
        closedBy,
        discrepancyLabel,
        labelRemitStatus(remitStatus),
        isManual ? "รอบมือ manual" : "",
        ...dropNotes.map((n) => n.reason),
        session.shift || "",
      ]
        .join(" ")
        .toLowerCase(),
    };
  });
}

type DaySummary = {
  total: number;
  bills: number;
  voids: number;
  cash: number;
  transfer: number;
  pp: number;
};

function daySummaryFromSales(sales: PosSale[]): DaySummary {
  let total = 0;
  let bills = 0;
  let voids = 0;
  let cash = 0;
  let transfer = 0;
  let pp = 0;
  for (const s of sales) {
    if (s.status === "voided") {
      voids += 1;
      continue;
    }
    bills += 1;
    total += s.total || 0;
    if (s.paymentMethod === "transfer") transfer += s.total || 0;
    else if (s.paymentMethod === "promptpay") pp += s.total || 0;
    else cash += s.total || 0;
  }
  return { total, bills, voids, cash, transfer, pp };
}

/**
 * Super-slim nPos sales-cycle rows — realtime, date newest→oldest, ~50 with scroll.
 * Smart table: search · multi-check · bulk delete (owner).
 */
export function PosSessionsSlimTable({
  sessions,
  sales,
  selectedSessionId,
  onSelect,
  onError,
  onForceClose,
  forceCloseBusyId = null,
  dayLabel = "ล่าสุด",
  actorId = "",
}: {
  sessions: PosSession[];
  sales: PosSale[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  onError?: (msg: string | null) => void;
  /** Trial: owner can force-close open rounds from BO. */
  onForceClose?: (sessionId: string) => void;
  forceCloseBusyId?: string | null;
  dayLabel?: string;
  /** Owner actor for remit handoff / manual rounds */
  actorId?: string;
}) {
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [pulseSec, setPulseSec] = useState(5);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [pulseHint, setPulseHint] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [pendingRemitOnly, setPendingRemitOnly] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [queryText, setQueryText] = useState("");
  const deferredQuery = useDeferredValue(queryText.trim().toLowerCase());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [handoffBusyId, setHandoffBusyId] = useState<string | null>(null);
  const [handoffDraft, setHandoffDraft] = useState<{
    sessionId: string;
    amount: string;
    handedBy: string;
    receivedBy: string;
    note: string;
  } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualForm, setManualForm] = useState({
    label: "",
    date: todayInputValue(),
    remit: "",
    counted: "",
    leave: "",
    cashTotal: "",
    openedBy: "",
    note: "",
  });

  useEffect(() => {
    return subscribePosDevicesAdmin(
      setDevices,
      (err) => onError?.(err.message),
    );
  }, [onError]);

  useEffect(() => {
    const hasOpen = sessions.some((s) => s.status === "open");
    if (!hasOpen) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [sessions]);

  const loadPulse = useCallback(async () => {
    try {
      setPulseSec(await getHeartbeatIntervalSec());
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  useEffect(() => {
    void loadPulse();
  }, [loadPulse]);

  async function savePulse(nextRaw: number) {
    setPulseBusy(true);
    setPulseHint(null);
    try {
      const next = await setHeartbeatIntervalSec(clampHeartbeatIntervalSec(nextRaw));
      setPulseSec(next);
      setPulseHint(`ชีพจร ${next} วิ`);
      onError?.(null);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setPulseBusy(false);
    }
  }

  const devicesById = useMemo(() => {
    const m = new Map<string, PosDevice>();
    for (const d of devices) m.set(d.id, d);
    return m;
  }, [devices]);

  const rows = useMemo(
    () => buildRows(sessions, sales, devicesById, nowMs),
    [sessions, sales, devicesById, nowMs],
  );

  const daySum = useMemo(() => daySummaryFromSales(sales), [sales]);
  const openCount = useMemo(() => rows.filter((r) => r.open).length, [rows]);
  const pendingRemitCount = useMemo(
    () =>
      rows.filter(
        (r) => r.remitStatus === "pending" || r.remitStatus === "mismatch",
      ).length,
    [rows],
  );

  const deviceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const id = row.session.deviceId || "";
      if (!id || seen.has(id)) continue;
      seen.set(id, row.pairingCode !== "—" ? row.pairingCode : row.deviceLabel);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (openOnly && !row.open) return false;
      if (
        pendingRemitOnly &&
        row.remitStatus !== "pending" &&
        row.remitStatus !== "mismatch"
      ) {
        return false;
      }
      if (deviceId && row.session.deviceId !== deviceId) return false;
      if (deferredQuery && !row.searchBlob.includes(deferredQuery)) return false;
      return true;
    });
  }, [rows, openOnly, pendingRemitOnly, deviceId, deferredQuery]);

  const handoffSeedKey = useMemo(() => {
    if (!selectedSessionId) return "";
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session) return selectedSessionId;
    return `${session.id}:${session.remitStatus || ""}:${session.remitHandedAt || 0}`;
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setHandoffDraft(null);
      return;
    }
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (!session || session.status !== "closed") {
      setHandoffDraft(null);
      return;
    }
    const remit =
      session.remitAmount != null
        ? session.remitAmount
        : session.closingCashCounted != null && session.leaveFloat != null
          ? Math.max(0, session.closingCashCounted - session.leaveFloat)
          : undefined;
    if (remit == null) {
      setHandoffDraft(null);
      return;
    }
    setHandoffDraft({
      sessionId: session.id,
      amount:
        session.remitHandedAmount != null && session.remitHandedAmount > 0
          ? String(session.remitHandedAmount)
          : String(remit),
      handedBy: session.remitHandedByName || session.openedByName || "",
      receivedBy: session.remitReceivedByName || "",
      note: session.remitHandoffNote || "",
    });
    // Re-seed on select or after server handoff save — not on unrelated session churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handoffSeedKey gates refresh
  }, [handoffSeedKey]);

  const visibleIds = useMemo(
    () => filteredRows.map((r) => r.session.id),
    [filteredRows],
  );

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const keepPairing = NPOS_SHOP_KEEP_PAIRING_CODE;
  const nonKeepVisibleIds = useMemo(
    () =>
      filteredRows
        .filter((r) => r.pairingCode.toUpperCase() !== keepPairing)
        .map((r) => r.session.id),
    [filteredRows, keepPairing],
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(sessions.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  function resetDayFilters() {
    setOpenOnly(false);
    setPendingRemitOnly(false);
    setDeviceId(null);
  }

  async function saveHandoff(session: PosSession) {
    if (!handoffDraft || handoffDraft.sessionId !== session.id || !actorId) return;
    setHandoffBusyId(session.id);
    onError?.(null);
    try {
      await recordPosSessionRemitHandoff(session.id, session, {
        handedAmount: Number(handoffDraft.amount) || 0,
        handedByName: handoffDraft.handedBy,
        receivedByName: handoffDraft.receivedBy,
        note: handoffDraft.note,
        actorId,
      });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setHandoffBusyId(null);
    }
  }

  async function clearHandoff(sessionId: string) {
    setHandoffBusyId(sessionId);
    onError?.(null);
    try {
      await clearPosSessionRemitHandoff(sessionId);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setHandoffBusyId(null);
    }
  }

  async function submitManualRound() {
    if (!actorId || manualBusy) return;
    setManualBusy(true);
    onError?.(null);
    try {
      const dateMs = startOfLocalDay(
        new Date(`${manualForm.date}T00:00:00+07:00`),
      );
      const id = await createManualPosSession({
        actorId,
        label: manualForm.label,
        date: dateMs,
        remitAmount: manualForm.remit ? Number(manualForm.remit) : undefined,
        closingCashCounted: manualForm.counted
          ? Number(manualForm.counted)
          : undefined,
        leaveFloat: manualForm.leave ? Number(manualForm.leave) : undefined,
        cashTotal: manualForm.cashTotal ? Number(manualForm.cashTotal) : undefined,
        openedByName: manualForm.openedBy,
        note: manualForm.note,
      });
      setManualOpen(false);
      setManualForm({
        label: "",
        date: todayInputValue(),
        remit: "",
        counted: "",
        leave: "",
        cashTotal: "",
        openedBy: "",
        note: "",
      });
      onSelect(id);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setManualBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (visibleIds.length === 0) return prev;
      const allOn = visibleIds.every((id) => prev.has(id));
      if (allOn) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  function selectNonKeepVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of nonKeepVisibleIds) next.add(id);
      return next;
    });
  }

  function clearSelected() {
    setSelectedIds(new Set());
  }

  async function confirmBulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    onError?.(null);
    try {
      const result = await deletePosSessionsAdmin(ids);
      if (selectedSessionId && ids.includes(selectedSessionId)) onSelect(null);
      setSelectedIds(new Set());
      setConfirmDelete(false);
      window.alert(
        `ลบแล้ว ${result.deletedSessions} รอบ · บิล ${result.deletedSales}`,
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  const emptyDay = sessions.length === 0;
  const selectedCount = selectedIds.size;

  return (
    <section className="npos-slim-sessions">
      <header className="npos-slim-sessions-head">
        <div className="npos-slim-sessions-title">
          <h3>รอบการขาย nPos</h3>
          <span className="muted">
            {filteredRows.length}
            {filteredRows.length !== rows.length ? `/${rows.length}` : ""} รอบ · วันใหม่→เก่า · ≤
            {POS_SESSIONS_SLIM_LIMIT}
            {openCount ? ` · active ${openCount}` : ""}
            {pendingRemitCount ? ` · ค้างส่ง ${pendingRemitCount}` : ""}
          </span>
        </div>
        <div className="npos-slim-sessions-actions">
          {!CASH_IN_NPOS_REMIT_ONLY ? (
            <button
              type="button"
              className="npos-slim-text-btn"
              disabled={!actorId || manualBusy}
              title="เพิ่มรอบปิดสำหรับเคาน์เตอร์นอกโปรแกรม"
              onClick={() => setManualOpen(true)}
            >
              +รอบมือ
            </button>
          ) : null}
          <PulseChips
            sec={pulseSec}
            busy={pulseBusy}
            hint={pulseHint}
            onPick={(n) => void savePulse(n)}
          />
        </div>
      </header>

      <p className="npos-slim-summary" aria-label="สรุปยอดในหน้าต่าง">
        <strong>฿{formatPlainNumber(daySum.total)}</strong>
        <span className="muted">ยอดในหน้าต่างบิล</span>
        <span>·</span>
        <span>{daySum.bills} บิล</span>
        <span>·</span>
        <span>ทำลาย {daySum.voids || "—"}</span>
        <span>·</span>
        <span>
          สด {moneyOrDash(daySum.cash)} / โอน {moneyOrDash(daySum.transfer)} / PP{" "}
          {moneyOrDash(daySum.pp)}
        </span>
      </p>

      {!emptyDay ? (
        <>
          <div className="npos-slim-filters" role="toolbar" aria-label="กรองรอบ">
            <button
              type="button"
              className={`npos-slim-text-btn ${!openOnly && !pendingRemitOnly && !deviceId ? "is-active" : ""}`}
              onClick={resetDayFilters}
            >
              {dayLabel}
            </button>
            <button
              type="button"
              className={`npos-slim-text-btn ${openOnly ? "is-active" : ""}`}
              onClick={() => setOpenOnly((v) => !v)}
            >
              เปิดอยู่
            </button>
            <button
              type="button"
              className={`npos-slim-text-btn ${pendingRemitOnly ? "is-active" : ""}`}
              onClick={() => setPendingRemitOnly((v) => !v)}
              title="รอบที่ยังไม่ส่งเงิน หรือส่งไม่ตรง"
            >
              ค้างส่ง{pendingRemitCount ? ` ${pendingRemitCount}` : ""}
            </button>
            {deviceOptions.length > 1
              ? deviceOptions.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`npos-slim-text-btn ${deviceId === d.id ? "is-active" : ""}`}
                    title={d.label}
                    onClick={() => setDeviceId((cur) => (cur === d.id ? null : d.id))}
                  >
                    {d.label}
                  </button>
                ))
              : null}
          </div>

          <div className="table-search npos-slim-search">
            <input
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="ค้นรหัสเครื่อง · รหัสรอบ · วันที่ · เปิด/ปิด"
              aria-label="ค้นหารอบการขาย"
            />
            {queryText ? (
              <button
                type="button"
                className="ghost-btn table-search-clear"
                onClick={() => setQueryText("")}
              >
                ล้าง
              </button>
            ) : null}
          </div>

          <div className="bulk-status-toolbar npos-slim-bulk" role="group" aria-label="เลือกหลายรอบ">
            <button
              type="button"
              className="ghost-btn bulk-status-chip"
              disabled={bulkBusy || !visibleIds.length}
              onClick={toggleSelectAllVisible}
            >
              {allVisibleSelected ? "ยกเลิกที่แสดง" : `เลือกที่แสดง (${visibleIds.length})`}
            </button>
            {nonKeepVisibleIds.length > 0 ? (
              <button
                type="button"
                className="ghost-btn bulk-status-chip"
                disabled={bulkBusy}
                title={`ติ๊กทุกรอบที่ไม่ใช่เครื่อง ${keepPairing}`}
                onClick={selectNonKeepVisible}
              >
                เลือกที่ไม่ใช่ {keepPairing}
              </button>
            ) : null}
            {selectedCount > 0 ? (
              <div className="bulk-status-actions" role="group" aria-label="ลบรอบที่เลือก">
                <span className="bulk-status-count">เลือก {selectedCount} รอบ</span>
                <button
                  type="button"
                  className="ghost-btn bulk-status-btn npos-slim-bulk-delete"
                  disabled={bulkBusy}
                  onClick={() => setConfirmDelete(true)}
                >
                  ลบที่เลือก
                </button>
                <button
                  type="button"
                  className="ghost-btn bulk-status-clear"
                  disabled={bulkBusy}
                  onClick={clearSelected}
                >
                  ยกเลิก
                </button>
              </div>
            ) : (
              <p className="muted bulk-status-hint">
                ติ๊กหน้าแถว · ค้น/กรอง · เลือกที่แสดง หรือเลือกที่ไม่ใช่ {keepPairing} → ลบที่เลือก
              </p>
            )}
          </div>
        </>
      ) : null}

      {emptyDay ? (
        <p className="muted npos-slim-empty">ยังไม่มีรอบ nPos — เปิดกะที่แท็บเล็ต</p>
      ) : filteredRows.length === 0 ? (
        <p className="muted npos-slim-empty">
          {deferredQuery ? "ไม่พบรอบตามคำค้น" : "ไม่มีรอบตามตัวกรอง"}
        </p>
      ) : (
        <div className="npos-slim-scroll npos-slim-scroll--rows" role="table" aria-label="รอบการขาย nPos">
          <div className="npos-slim-row npos-slim-row--head npos-slim-row--sessions-super" role="row">
            <span role="columnheader" className="npos-slim-check-col" aria-label="เลือก">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                }}
                onChange={toggleSelectAllVisible}
                aria-label="เลือกทั้งหมดที่แสดง"
              />
            </span>
            <span role="columnheader" title="สถานะรอบ">
              สถานะ
            </span>
            <span role="columnheader">วันที่</span>
            <span role="columnheader" title="รหัสเครื่อง">
              เครื่อง
            </span>
            <span role="columnheader">เริ่ม</span>
            <span role="columnheader">ปิด</span>
            <span role="columnheader" title="พนักงานเปิดรอบ">
              เข้า
            </span>
            <span role="columnheader" title="พนักงานปิดรอบ / ปิดจากหลังร้าน">
              ปิดโดย
            </span>
            <span role="columnheader" className="npos-slim-num">
              บิล
            </span>
            <span role="columnheader" className="npos-slim-num">
              ยอด
            </span>
            <span role="columnheader" className="npos-slim-num npos-slim-cash">
              สด
            </span>
            <span role="columnheader" className="npos-slim-num">
              โอน
            </span>
            <span
              role="columnheader"
              className="npos-slim-num"
              title="ยอดนำส่ง = นับ − ทอนค้างรอบถัดไป"
            >
              นำส่ง
            </span>
            <span role="columnheader" title="สถานะส่งเงินสดตามจริง">
              ส่ง
            </span>
            <span role="columnheader" title="ปิดรอบจากหลังร้าน">
              ปิด
            </span>
          </div>

          {filteredRows.map((row) => {
            const selected = selectedSessionId === row.session.id;
            const checked = selectedIds.has(row.session.id);
            const closing = forceCloseBusyId === row.session.id;
            return (
              <div key={row.session.id} className="npos-slim-block">
                <div
                  role="row"
                  className={`npos-slim-row npos-slim-row--sessions-super ${row.open ? "is-open" : ""} ${selected ? "is-selected" : ""} ${checked ? "is-bulk-selected" : ""}`}
                  onClick={() => onSelect(selected ? null : row.session.id)}
                >
                  <span
                    className="npos-slim-check-col"
                    role="cell"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(row.session.id)}
                      aria-label={`เลือก ${row.pairingCode} ${row.sessionCode}`}
                    />
                  </span>
                  <span className="npos-slim-status" role="cell">
                    <i aria-hidden className={row.open ? "is-live" : ""} />
                    {row.open ? "เปิด" : "ปิด"}
                  </span>
                  <span role="cell" title={row.dateLabel}>
                    {row.dateLabel}
                  </span>
                  <span
                    role="cell"
                    className="npos-slim-code npos-slim-device"
                    title={
                      row.openedBy
                        ? `${row.deviceLabel} · ผู้เปิด ${row.openedBy} · ${row.session.deviceId}`
                        : `${row.deviceLabel} · ${row.session.deviceId}`
                    }
                  >
                    {row.pairingCode}
                  </span>
                  <span role="cell" className="npos-slim-time">
                    {formatHm(row.session.openedAt)}
                  </span>
                  <span role="cell" className="npos-slim-time">
                    {row.session.closedAt ? formatHm(row.session.closedAt) : "—"}
                  </span>
                  <span
                    role="cell"
                    className="npos-slim-staff"
                    title={row.openedBy ? `ผู้เปิด ${row.openedBy}` : "ยังไม่มีชื่อผู้เปิด"}
                  >
                    {row.openedBy || "—"}
                  </span>
                  <span
                    role="cell"
                    className="npos-slim-staff"
                    title={
                      row.open
                        ? "ยังไม่ปิดกะ"
                        : row.closedBy
                          ? `ผู้ปิด ${row.closedBy}`
                          : "ยังไม่มีชื่อผู้ปิด (รอบเก่าหรือปิดก่อนอัปเดต)"
                    }
                  >
                    {row.open ? "—" : row.closedBy || "—"}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.bills || "—"}
                  </span>
                  <span role="cell" className="npos-slim-num npos-slim-strong">
                    {moneyOrDash(row.total)}
                  </span>
                  <span role="cell" className="npos-slim-num npos-slim-cash">
                    {moneyOrDash(row.cash)}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {moneyOrDash(row.transfer)}
                  </span>
                  <span
                    role="cell"
                    className="npos-slim-num"
                    title={
                      row.open
                        ? "ยังไม่ปิดกะ"
                        : row.remit != null
                          ? `นำส่ง ${moneyOrDash(row.remit)}`
                          : "ยังไม่มียอดนำส่ง"
                    }
                  >
                    {row.open || row.remit == null ? "—" : moneyOrDash(row.remit)}
                  </span>
                  <span
                    role="cell"
                    className={`npos-slim-remit-status is-${row.remitStatus || "none"}`}
                    title={
                      row.remitStatus === "handed" && row.remitHanded != null
                        ? `รับจริง ${moneyOrDash(row.remitHanded)}`
                        : row.remitStatus === "mismatch" && row.remitHanded != null
                          ? `รับจริง ${moneyOrDash(row.remitHanded)} ≠ นำส่ง ${moneyOrDash(row.remit)}`
                          : row.remitStatus === "pending"
                            ? "ยังไม่ได้บันทึกส่งเงิน"
                            : "ยังไม่มียอดนำส่ง"
                    }
                  >
                    {labelRemitStatus(row.remitStatus)}
                  </span>
                  <span role="cell" className="npos-slim-close-cell">
                    {row.open && onForceClose ? (
                      <button
                        type="button"
                        className="npos-slim-text-btn npos-slim-close-btn"
                        disabled={closing || bulkBusy}
                        title="ทดลอง: ปิดรอบจากหลังร้าน"
                        onClick={(e) => {
                          e.stopPropagation();
                          onForceClose(row.session.id);
                        }}
                      >
                        {closing ? "…" : "ปิด"}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                </div>
                {selected ? (
                  <div className="npos-slim-detail" role="row">
                    <span>
                      {row.isManual ? "รอบมือ · " : ""}
                      รอบ {row.sessionCode}
                      {row.openedBy ? ` · เข้า ${row.openedBy}` : ""}
                      {!row.open && row.closedBy ? ` · ปิดโดย ${row.closedBy}` : ""}
                      {` · รวม ${row.durationLabel}`}
                      {` · ทอนเริ่ม ${moneyOrDash(row.opening)}`}
                      {row.open ? " · ระหว่างกะ" : ""}
                      {` · PP ${moneyOrDash(row.pp)}`}
                      {(row.cashOut != null && row.cashOut > 0) ||
                      (row.cashDrops != null && row.cashDrops > 0)
                        ? ` · ถอน ${moneyOrDash(row.cashOut)}${
                            row.cashDrops ? ` (${row.cashDrops} ครั้ง)` : ""
                          }`
                        : ""}
                      {row.cashIn != null && row.cashIn > 0
                        ? ` · เติม ${moneyOrDash(row.cashIn)}`
                        : ""}
                      {!row.open && row.counted != null
                        ? ` · นับ ${moneyOrDash(row.counted)} · ควรมี ${moneyOrDash(row.expected)} · ส่วนต่าง ${moneyOrDash(row.diff)}`
                        : ""}
                      {!row.open && row.discrepancyLabel
                        ? ` · ${row.discrepancyLabel}`
                        : ""}
                      {!row.open && row.leave != null
                        ? ` · ทอนค้าง ${moneyOrDash(row.leave)}`
                        : ""}
                      {!row.open && row.remit != null
                        ? ` · นำส่ง ${moneyOrDash(row.remit)}`
                        : ""}
                      {!row.open && row.remitStatus
                        ? ` · ส่ง ${labelRemitStatus(row.remitStatus)}`
                        : ""}
                      {!row.open && row.discount != null && row.discount > 0
                        ? ` · ส่วนลด ${moneyOrDash(row.discount)}`
                        : ""}
                      {!row.open && row.voids > 0 ? ` · void ${row.voids}` : ""}
                      {!row.open &&
                      ((row.cashBills != null && row.cashBills > 0) ||
                        (row.ppBills != null && row.ppBills > 0) ||
                        (row.transferBills != null && row.transferBills > 0))
                        ? ` · บิล สด ${row.cashBills ?? 0} / โอน ${row.transferBills ?? 0} / PP ${row.ppBills ?? 0}`
                        : ""}
                      {row.note
                        ? ` · ${row.note}`
                        : !row.open &&
                            row.discrepancyLabel &&
                            row.discrepancyLabel !== "ตรง"
                          ? " · ไม่มีเหตุผล"
                          : ""}
                      {" · "}
                      <button
                        type="button"
                        className="npos-slim-text-btn"
                        onClick={() => onSelect(null)}
                      >
                        ทุกบิล
                      </button>
                    </span>
                    {row.dropNotes.length > 0 ? (
                      <ul className="npos-slim-drop-notes">
                        {row.dropNotes.map((n, i) => (
                          <li key={`${row.session.id}-drop-${i}-${n.at}`}>
                            ถอน {formatHm(n.at)} · ฿{moneyOrDash(n.amount)}
                            {n.reason ? ` · ${n.reason}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {!row.open && row.remit != null && handoffDraft?.sessionId === row.session.id ? (
                      <div
                        className="npos-slim-remit-handoff"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="npos-slim-remit-handoff-title">
                          ส่งเงินตามจริง · ต้องนำส่ง ฿{moneyOrDash(row.remit)}
                        </p>
                        <div className="npos-slim-remit-handoff-grid">
                          <label>
                            รับจริง
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={handoffDraft.amount}
                              disabled={handoffBusyId === row.session.id}
                              onChange={(e) =>
                                setHandoffDraft((d) =>
                                  d ? { ...d, amount: e.target.value } : d,
                                )
                              }
                            />
                          </label>
                          <label>
                            ผู้ส่ง
                            <input
                              type="text"
                              maxLength={80}
                              value={handoffDraft.handedBy}
                              disabled={handoffBusyId === row.session.id}
                              onChange={(e) =>
                                setHandoffDraft((d) =>
                                  d ? { ...d, handedBy: e.target.value } : d,
                                )
                              }
                            />
                          </label>
                          <label>
                            ผู้รับ
                            <input
                              type="text"
                              maxLength={80}
                              value={handoffDraft.receivedBy}
                              disabled={handoffBusyId === row.session.id}
                              onChange={(e) =>
                                setHandoffDraft((d) =>
                                  d ? { ...d, receivedBy: e.target.value } : d,
                                )
                              }
                            />
                          </label>
                          <label className="npos-slim-remit-handoff-note">
                            โน้ต
                            <input
                              type="text"
                              maxLength={240}
                              value={handoffDraft.note}
                              disabled={handoffBusyId === row.session.id}
                              onChange={(e) =>
                                setHandoffDraft((d) =>
                                  d ? { ...d, note: e.target.value } : d,
                                )
                              }
                            />
                          </label>
                        </div>
                        <div className="npos-slim-remit-handoff-actions">
                          <button
                            type="button"
                            className="npos-slim-text-btn is-active"
                            disabled={
                              !actorId || handoffBusyId === row.session.id
                            }
                            onClick={() => void saveHandoff(row.session)}
                          >
                            {handoffBusyId === row.session.id
                              ? "…"
                              : "บันทึกส่งเงิน"}
                          </button>
                          {row.remitStatus === "handed" ||
                          row.remitStatus === "mismatch" ? (
                            <button
                              type="button"
                              className="npos-slim-text-btn"
                              disabled={handoffBusyId === row.session.id}
                              onClick={() => void clearHandoff(row.session.id)}
                            >
                              กลับเป็นค้าง
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="muted npos-slim-foot">
        แถวหลัก = สถานะ/เวลา/<strong>เข้า</strong>/<strong>ปิดโดย</strong>/ยอดเงิน · กดแถวดูรหัสรอบ
        · รวมเวลา · PP · นับ · <strong>นำส่ง</strong> = นับ − ทอนค้าง · <strong>ส่ง</strong> =
        รับจริงหลังปิดรอบ
        {CASH_IN_NPOS_REMIT_ONLY
          ? " · ยอดต้องโอนใช้รอบ nPos อย่างเดียว"
          : " · +รอบมือ = เคาน์เตอร์นอกโปรแกรม"}{" "}
        · <strong>ปิด</strong> จากหลังร้าน · <strong>ลบที่เลือก</strong> ลบรอบ+บิลถาวร
      </p>

      <PosConfirmDialog
        open={confirmDelete}
        title={`ลบ ${selectedCount} รอบที่เลือก?`}
        message="ลบถาวรทั้งรอบและบิลในรอบนั้น — กู้คืนไม่ได้"
        confirmLabel={bulkBusy ? "กำลังลบ…" : "ลบถาวร"}
        cancelLabel="ยกเลิก"
        destructive
        busy={bulkBusy}
        onConfirm={() => void confirmBulkDelete()}
        onCancel={() => {
          if (!bulkBusy) setConfirmDelete(false);
        }}
      />

      {!CASH_IN_NPOS_REMIT_ONLY && manualOpen ? (
        <div className="npos-slim-manual-panel" role="region" aria-label="เพิ่มรอบมือ">
          <header className="npos-slim-manual-head">
            <h4>เพิ่มรอบมือ</h4>
            <p className="muted">
              เคาน์เตอร์นอกโปรแกรม — กรอกยอดนำส่ง (หรือ นับ + ทอนค้าง) เป็นรอบปิด
            </p>
          </header>
          <div className="npos-slim-manual-form">
            <label>
              ชื่อเคาน์เตอร์
              <input
                type="text"
                maxLength={80}
                value={manualForm.label}
                disabled={manualBusy}
                placeholder="เช่น หน้าร้าน 2 / FoodStory"
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, label: e.target.value }))
                }
              />
            </label>
            <label>
              วันที่ขาย
              <input
                type="date"
                value={manualForm.date}
                disabled={manualBusy}
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, date: e.target.value }))
                }
              />
            </label>
            <label>
              ยอดนำส่ง
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={manualForm.remit}
                disabled={manualBusy}
                placeholder="บาท"
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, remit: e.target.value }))
                }
              />
            </label>
            <label>
              นับจริง (ถ้ามี)
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={manualForm.counted}
                disabled={manualBusy}
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, counted: e.target.value }))
                }
              />
            </label>
            <label>
              ทอนค้าง (ถ้ามี)
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={manualForm.leave}
                disabled={manualBusy}
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, leave: e.target.value }))
                }
              />
            </label>
            <label>
              ขายสด (ถ้ามี)
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={manualForm.cashTotal}
                disabled={manualBusy}
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, cashTotal: e.target.value }))
                }
              />
            </label>
            <label>
              ผู้ปิดรอบ
              <input
                type="text"
                maxLength={80}
                value={manualForm.openedBy}
                disabled={manualBusy}
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, openedBy: e.target.value }))
                }
              />
            </label>
            <label className="npos-slim-manual-form-wide">
              โน้ต
              <input
                type="text"
                maxLength={240}
                value={manualForm.note}
                disabled={manualBusy}
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, note: e.target.value }))
                }
              />
            </label>
          </div>
          <div className="npos-slim-manual-actions">
            <button
              type="button"
              className="npos-slim-text-btn is-active"
              disabled={manualBusy || !actorId}
              onClick={() => void submitManualRound()}
            >
              {manualBusy ? "กำลังบันทึก…" : "สร้างรอบ"}
            </button>
            <button
              type="button"
              className="npos-slim-text-btn"
              disabled={manualBusy}
              onClick={() => setManualOpen(false)}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PulseChips({
  sec,
  busy,
  hint,
  onPick,
}: {
  sec: number;
  busy: boolean;
  hint: string | null;
  onPick: (n: number) => void;
}) {
  return (
    <div className="npos-slim-pulse" role="group" aria-label="ช่วงเช็คเซิร์ฟเวอร์">
      <span className="npos-slim-pulse-label">เช็คเซิร์ฟเวอร์</span>
      {HEARTBEAT_INTERVAL_PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          className={`npos-slim-text-btn ${sec === p ? "is-active" : ""}`}
          disabled={busy}
          onClick={() => onPick(p)}
        >
          {p}วิ
        </button>
      ))}
      {hint ? <span className="npos-slim-pulse-hint">{hint}</span> : null}
    </div>
  );
}
