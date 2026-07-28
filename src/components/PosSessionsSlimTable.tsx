"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { labelOtShift, type OtShiftId } from "@/lib/ot";
import {
  HEARTBEAT_INTERVAL_PRESETS,
  clampHeartbeatIntervalSec,
  getHeartbeatIntervalSec,
  setHeartbeatIntervalSec,
} from "@/lib/pos-tablet-sync";
import {
  posDeviceLabel,
  subscribePosDevicesAdmin,
  type PosDevice,
} from "@/lib/pos-devices";
import {
  salesForSession,
  voidedForSession,
} from "@/lib/pos-sales-report";
import type { PosSale, PosSession } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

function formatHm(ts: number): string {
  return new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function moneyOrDash(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.0001) return "0";
  return formatPlainNumber(n);
}

function shortShift(shift: string): string {
  if (shift === "morning") return "เช้า";
  if (shift === "evening") return "เย็น";
  if (shift === "late") return "ดึก";
  return labelOtShift(shift as OtShiftId);
}

type RowModel = {
  session: PosSession;
  deviceLabel: string;
  open: boolean;
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
  note: string;
};

function buildRows(
  sessions: PosSession[],
  sales: PosSale[],
  devicesById: Map<string, PosDevice>,
): RowModel[] {
  const sorted = [...sessions].sort((a, b) => {
    const aOpen = a.status === "open" ? 1 : 0;
    const bOpen = b.status === "open" ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    if (a.status === "open") return (b.openedAt || 0) - (a.openedAt || 0);
    const aClosed = a.closedAt || a.openedAt || 0;
    const bClosed = b.closedAt || b.openedAt || 0;
    return bClosed - aClosed;
  });
  return sorted.map((session) => {
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
    return {
      session,
      deviceLabel: device
        ? posDeviceLabel(device)
        : session.deviceId
          ? `#${session.deviceId.slice(-4).toUpperCase()}`
          : "—",
      open: session.status === "open",
      total: salesTotal || session.totalSales || 0,
      bills: active.length || session.saleCount || 0,
      voids: voided.length || session.voidedCount || 0,
      cash: session.cashTotal ?? cashSum,
      transfer: session.transferTotal ?? transferSum,
      pp: session.promptpayTotal ?? ppSum,
      opening: session.openingCash,
      counted: session.closingCashCounted,
      expected: session.expectedCash,
      diff: session.cashDifference,
      leave: session.leaveFloat,
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
 * Super-slim one-line session rows for BO — open first, closed newest first.
 * Thin filters (day / open / device / shift) + day summary bar; no close-shift CTA.
 */
export function PosSessionsSlimTable({
  sessions,
  sales,
  selectedSessionId,
  onSelect,
  onError,
  dayLabel = "วันนี้",
}: {
  sessions: PosSession[];
  sales: PosSale[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  onError?: (msg: string | null) => void;
  /** Chip label for “all sessions on this date” — usually วันนี้. */
  dayLabel?: string;
}) {
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [pulseSec, setPulseSec] = useState(5);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [pulseHint, setPulseHint] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState<OtShiftId | null>(null);

  useEffect(() => {
    return subscribePosDevicesAdmin(
      setDevices,
      (err) => onError?.(err.message),
    );
  }, [onError]);

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
    () => buildRows(sessions, sales, devicesById),
    [sessions, sales, devicesById],
  );

  const daySum = useMemo(() => daySummaryFromSales(sales), [sales]);

  const deviceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const id = row.session.deviceId || "";
      if (!id || seen.has(id)) continue;
      seen.set(id, row.deviceLabel);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [rows]);

  const shiftOptions = useMemo(() => {
    const set = new Set<OtShiftId>();
    for (const row of rows) {
      const sh = row.session.shift as OtShiftId;
      if (sh === "morning" || sh === "evening" || sh === "late") set.add(sh);
    }
    return (["morning", "evening", "late"] as OtShiftId[]).filter((id) => set.has(id));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (openOnly && !row.open) return false;
      if (deviceId && row.session.deviceId !== deviceId) return false;
      if (shiftId && row.session.shift !== shiftId) return false;
      return true;
    });
  }, [rows, openOnly, deviceId, shiftId]);

  function resetDayFilters() {
    setOpenOnly(false);
    setDeviceId(null);
    setShiftId(null);
  }

  const emptyDay = sessions.length === 0;

  return (
    <section className="npos-slim-sessions">
      <header className="npos-slim-sessions-head">
        <div className="npos-slim-sessions-title">
          <h3>รอบการขาย</h3>
          <span className="muted">
            {filteredRows.length}
            {filteredRows.length !== rows.length ? `/${rows.length}` : ""} รอบ · realtime
          </span>
        </div>
        <PulseChips
          sec={pulseSec}
          busy={pulseBusy}
          hint={pulseHint}
          onPick={(n) => void savePulse(n)}
        />
      </header>

      <p className="npos-slim-summary" aria-label="สรุปยอดวัน">
        <strong>฿{formatPlainNumber(daySum.total)}</strong>
        <span className="muted">ยอด{dayLabel}</span>
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
            className={`npos-slim-text-btn ${!openOnly && !deviceId && !shiftId ? "is-active" : ""}`}
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
          {shiftOptions.map((id) => (
            <button
              key={id}
              type="button"
              className={`npos-slim-text-btn ${shiftId === id ? "is-active" : ""}`}
              onClick={() => setShiftId((cur) => (cur === id ? null : id))}
            >
              {shortShift(id)}
            </button>
          ))}
        </div>
      ) : null}

      {emptyDay ? (
        <p className="muted npos-slim-empty">ยังไม่มีรอบในวันนี้</p>
      ) : filteredRows.length === 0 ? (
        <p className="muted npos-slim-empty">ไม่มีรอบตามตัวกรอง</p>
      ) : (
        <div className="npos-slim-scroll" role="table" aria-label="รอบการขาย">
          <div className="npos-slim-row npos-slim-row--head" role="row">
            <span role="columnheader">สถานะ</span>
            <span role="columnheader">เครื่อง</span>
            <span role="columnheader">รอบ</span>
            <span role="columnheader">เริ่ม</span>
            <span role="columnheader">ปิด</span>
            <span role="columnheader" className="npos-slim-num">
              บิล
            </span>
            <span role="columnheader" className="npos-slim-num">
              ทำลาย
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
          </div>

          {filteredRows.map((row) => {
            const selected = selectedSessionId === row.session.id;
            return (
              <div key={row.session.id} className="npos-slim-block">
                <button
                  type="button"
                  role="row"
                  className={`npos-slim-row ${row.open ? "is-open" : ""} ${selected ? "is-selected" : ""}`}
                  onClick={() => onSelect(selected ? null : row.session.id)}
                >
                  <span className="npos-slim-status" role="cell">
                    <i aria-hidden className={row.open ? "is-live" : ""} />
                    {row.open ? "เปิด" : "ปิด"}
                  </span>
                  <span role="cell" className="npos-slim-ellipsis" title={row.deviceLabel}>
                    {row.deviceLabel}
                  </span>
                  <span role="cell">{shortShift(row.session.shift)}</span>
                  <span role="cell">{formatHm(row.session.openedAt)}</span>
                  <span role="cell">
                    {row.session.closedAt ? formatHm(row.session.closedAt) : "—"}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.bills || "—"}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.voids || "—"}
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
                </button>
                {selected ? (
                  <div className="npos-slim-detail" role="row">
                    <span>
                      ทอนเริ่ม {moneyOrDash(row.opening)}
                      {!row.open && row.counted != null
                        ? ` · นับ ${moneyOrDash(row.counted)} · ควรมี ${moneyOrDash(row.expected)} · ส่วนต่าง ${moneyOrDash(row.diff)}`
                        : ""}
                      {!row.open && row.leave != null
                        ? ` · ทอนค้าง ${moneyOrDash(row.leave)}`
                        : ""}
                      {row.note ? ` · ${row.note}` : ""}
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
        ปิดกะที่แท็บเล็ตเท่านั้น · แตะแถวเพื่อเปิดบิลของรอบ · ไม่มีปุ่มปิดกะในตารางนี้
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
