"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HEARTBEAT_INTERVAL_PRESETS,
  clampHeartbeatIntervalSec,
  getHeartbeatIntervalSec,
  setHeartbeatIntervalSec,
} from "@/lib/pos-tablet-sync";
import {
  posDeviceLabel,
  posPairingCodeFromId,
  subscribePosDevicesAdmin,
  type PosDevice,
} from "@/lib/pos-devices";
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
  return new Date(ts).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
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
    // Open rounds: prefer live bill window so totals update before close.
    const total = open ? salesTotal || session.totalSales || 0 : session.totalSales || salesTotal || 0;
    const bills = open ? active.length || session.saleCount || 0 : session.saleCount || active.length || 0;
    const cash = open ? cashSum || session.cashTotal || 0 : session.cashTotal ?? cashSum;
    const transfer = open
      ? transferSum || session.transferTotal || 0
      : session.transferTotal ?? transferSum;
    const pp = open ? ppSum || session.promptpayTotal || 0 : session.promptpayTotal ?? ppSum;
    return {
      session,
      deviceLabel: device
        ? posDeviceLabel(device)
        : session.deviceId
          ? `#${session.deviceId.slice(-4).toUpperCase()}`
          : "—",
      pairingCode: pairing,
      sessionCode: posSessionCode(session.id),
      open,
      dateLabel: formatDateShort(dayMs),
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
      note: session.discrepancyNote || "",
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
 * Super-slim nPos sales-cycle rows — realtime, newest first, ~50 with scroll.
 * Codes visible (owner-only). No date slider. No close-shift CTA (native only).
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
      return true;
    });
  }, [rows, openOnly, deviceId]);

  function resetDayFilters() {
    setOpenOnly(false);
    setDeviceId(null);
  }

  const emptyDay = sessions.length === 0;

  return (
    <section className="npos-slim-sessions">
      <header className="npos-slim-sessions-head">
        <div className="npos-slim-sessions-title">
          <h3>รอบการขาย nPos</h3>
          <span className="muted">
            {filteredRows.length}
            {filteredRows.length !== rows.length ? `/${rows.length}` : ""} รอบ · เปิดอยู่บน · ≤
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
      ) : null}

      {emptyDay ? (
        <p className="muted npos-slim-empty">ยังไม่มีรอบ nPos — เปิดกะที่แท็บเล็ต</p>
      ) : filteredRows.length === 0 ? (
        <p className="muted npos-slim-empty">ไม่มีรอบตามตัวกรอง</p>
      ) : (
        <div className="npos-slim-scroll npos-slim-scroll--rows" role="table" aria-label="รอบการขาย nPos">
          <div className="npos-slim-row npos-slim-row--head npos-slim-row--sessions-super" role="row">
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
            const closing = forceCloseBusyId === row.session.id;
            return (
              <div key={row.session.id} className="npos-slim-block">
                <div
                  role="row"
                  className={`npos-slim-row npos-slim-row--sessions-super ${row.open ? "is-open" : ""} ${selected ? "is-selected" : ""}`}
                  onClick={() => onSelect(selected ? null : row.session.id)}
                >
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
                        disabled={closing}
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
        <strong>ปิดรอบ</strong> จากหลังร้านใช้ช่วงทดลอง (แท็บเล็ตอาจยังคิดว่าเปิดอยู่จนกว่าซิงก์)
      </p>
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
