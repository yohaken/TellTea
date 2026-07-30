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
  posSessionCode,
  posSessionDurationMs,
  salesForSession,
  voidedForSession,
} from "@/lib/pos-sales-report";
import type { PosSale, PosSession } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

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
    const device = devicesById.get(session.deviceId);
    const pairing =
      device?.pairingCode ||
      (session.deviceId ? posPairingCodeFromId(session.deviceId) : "—");
    const dayMs = session.date || session.openedAt || 0;
    const total = open ? salesTotal || session.totalSales || 0 : session.totalSales || salesTotal || 0;
    const bills = open ? active.length || session.saleCount || 0 : session.saleCount || active.length || 0;
    const cash = open ? cashSum || session.cashTotal || 0 : session.cashTotal ?? cashSum;
    const transfer = open
      ? transferSum || session.transferTotal || 0
      : session.transferTotal ?? transferSum;
    const pp = open ? ppSum || session.promptpayTotal || 0 : session.promptpayTotal ?? ppSum;
    const deviceLabel = device
      ? posDeviceLabel(device)
      : session.deviceId
        ? `#${session.deviceId.slice(-4).toUpperCase()}`
        : "—";
    const sessionCode = posSessionCode(session.id);
    const dateLabel = formatDateShort(dayMs);
    const note = session.discrepancyNote || "";
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
      searchBlob: [
        pairing,
        sessionCode,
        deviceLabel,
        session.deviceId,
        session.id,
        dateLabel,
        open ? "เปิด" : "ปิด",
        note,
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
}) {
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [pulseSec, setPulseSec] = useState(5);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [pulseHint, setPulseHint] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [queryText, setQueryText] = useState("");
  const deferredQuery = useDeferredValue(queryText.trim().toLowerCase());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      if (deviceId && row.session.deviceId !== deviceId) return false;
      if (deferredQuery && !row.searchBlob.includes(deferredQuery)) return false;
      return true;
    });
  }, [rows, openOnly, deviceId, deferredQuery]);

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
    setDeviceId(null);
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
          </span>
        </div>
        <PulseChips
          sec={pulseSec}
          busy={pulseBusy}
          hint={pulseHint}
          onPick={(n) => void savePulse(n)}
        />
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
              className={`npos-slim-text-btn ${!openOnly && !deviceId ? "is-active" : ""}`}
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
            <span role="columnheader">สถานะ</span>
            <span role="columnheader">วันที่</span>
            <span role="columnheader">เครื่อง</span>
            <span role="columnheader" className="npos-slim-col-session">
              รหัสรอบ
            </span>
            <span role="columnheader">เริ่ม</span>
            <span role="columnheader">ปิด</span>
            <span role="columnheader" className="npos-slim-num">
              รวม
            </span>
            <span role="columnheader" className="npos-slim-num">
              บิล
            </span>
            <span role="columnheader" className="npos-slim-num">
              ยอด
            </span>
            <span role="columnheader" className="npos-slim-num">
              สด
            </span>
            <span role="columnheader" className="npos-slim-num">
              โอน
            </span>
            <span role="columnheader" className="npos-slim-num">
              PP
            </span>
            <span role="columnheader">ปิดรอบ</span>
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
                    className="npos-slim-code"
                    title={`${row.deviceLabel} · ${row.session.deviceId}`}
                  >
                    {row.pairingCode}
                  </span>
                  <span
                    role="cell"
                    className="npos-slim-code npos-slim-col-session"
                    title={row.session.id}
                  >
                    {row.sessionCode}
                  </span>
                  <span role="cell">{formatHm(row.session.openedAt)}</span>
                  <span role="cell">
                    {row.session.closedAt ? formatHm(row.session.closedAt) : "—"}
                  </span>
                  <span
                    role="cell"
                    className="npos-slim-num npos-slim-duration"
                    title={row.open ? "เวลารวมถึงตอนนี้" : "เวลารวมทั้งรอบ"}
                  >
                    {row.durationLabel}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.bills || "—"}
                  </span>
                  <span role="cell" className="npos-slim-num npos-slim-strong">
                    {moneyOrDash(row.total)}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {moneyOrDash(row.cash)}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {moneyOrDash(row.transfer)}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {moneyOrDash(row.pp)}
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
                      ทอนเริ่ม {moneyOrDash(row.opening)}
                      {row.open ? ` · ระหว่างกะ · ยอดจากบิล realtime` : ""}
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
                      {!row.open && row.leave != null
                        ? ` · ทอนค้าง ${moneyOrDash(row.leave)}`
                        : ""}
                      {row.note ? ` · ${row.note}` : ""}
                      {row.open ? ` · เวลารวม ${row.durationLabel}` : ` · รวม ${row.durationLabel}`}
                      {" · รายบิลด้านล่างกรองตามรอบนี้"}
                      {" · "}
                      <button
                        type="button"
                        className="npos-slim-text-btn"
                        onClick={() => onSelect(null)}
                      >
                        แสดงทุกบิล
                      </button>
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="muted npos-slim-foot">
        รอบ = กะ nPos · คอลัมน์กระชับ · รหัสรอบซ่อนเมื่อจอแคบ · รอบเปิดอยู่ขึ้นบนพร้อมยอด realtime ·
        คอลัมน์รวม = เวลารวมของรอบ · ปิดกะที่แท็บเล็ตเท่านั้นเป็นหลัก ·{" "}
        <strong>ปิดรอบ</strong> จากหลังร้าน · <strong>ลบที่เลือก</strong> ลบรอบ+บิลถาวร ·
        แท็บเล็ตรับสัญญาณผ่าน heartbeat (~5วิ) · ไม่เตะเครื่อง · จบบิลในตะกร้าได้แล้วเปิดรอบใหม่
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
