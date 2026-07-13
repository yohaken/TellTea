"use client";

import { useEffect, useMemo, useState } from "react";
import { usePosApp } from "@/lib/pos-app-context";
import {
  listLocalReceiptsForSession,
  summarizeLocalReceipts,
} from "@/lib/pos-local-receipts";
import { listLocalSessionsForDevice, saveLocalClosedSession } from "@/lib/pos-local-sessions";
import { closePosSession } from "@/lib/pos-session";
import { runPosSyncFlush } from "@/lib/pos-sync";
import { labelOtShift } from "@/lib/ot";
import { formatPlainNumber } from "@/lib/utils";

function formatTs(ts: number) {
  return new Date(ts).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PosShiftView() {
  const { session, device, selling, shift, syncSnap, setError } = usePosApp();
  const [closing, setClosing] = useState(false);
  const [tab, setTab] = useState<"current" | "history">("current");
  const [history, setHistory] = useState(() =>
    device ? listLocalSessionsForDevice(device.id) : [],
  );

  const shiftLabel = useMemo(() => labelOtShift(shift as "late" | "morning" | "evening"), [shift]);

  const sessionSummary = useMemo(() => {
    if (!session) return null;
    const receipts = listLocalReceiptsForSession(session.id);
    return summarizeLocalReceipts(receipts);
  }, [session]);

  const pendingSync = syncSnap.pendingCount + syncSnap.failedCount;

  useEffect(() => {
    if (!device) return;
    setHistory(listLocalSessionsForDevice(device.id));
  }, [device, session?.status, session?.id]);

  async function handleCloseShift() {
    if (!session || !selling || !device) return;

    if (pendingSync > 0) {
      setError(`ยังมีบิลค้างส่ง ${pendingSync} รายการ — รอซิงก์ก่อนปิดรอบ`);
      return;
    }

    if (syncSnap.syncing) {
      setError("กำลังส่งบิล — รอสักครู่แล้วลองใหม่");
      return;
    }

    const summary = sessionSummary || summarizeLocalReceipts(listLocalReceiptsForSession(session.id));
    const zLines = [
      `ปิดรอบ #${session.id.slice(-4).toUpperCase()} · ${shiftLabel}`,
      `บิล ${session.saleCount} · ยอด ฿${formatPlainNumber(session.totalSales)}`,
      `เงินสด ${summary.cashCount} ฿${formatPlainNumber(summary.cashTotal)}`,
      `PromptPay ${summary.promptpayCount} ฿${formatPlainNumber(summary.promptpayTotal)}`,
    ].join("\n");

    if (!window.confirm(`ปิดรอบการขายกะนี้?\n\n${zLines}`)) return;

    setClosing(true);
    setError(null);
    try {
      const flush = await runPosSyncFlush();
      if (flush.pendingCount + flush.failedCount > 0) {
        throw new Error(`ยังมีบิลค้างส่ง ${flush.pendingCount + flush.failedCount} รายการ`);
      }

      const closed = await closePosSession(session.id);
      saveLocalClosedSession({
        ...closed,
        closedAt: closed.closedAt || Date.now(),
        cashTotal: summary.cashTotal,
        promptpayTotal: summary.promptpayTotal,
      });
      setHistory(listLocalSessionsForDevice(device.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="pos-module">
      <div className="pos-module-subnav">
        <button type="button" className={tab === "current" ? "is-active" : ""} onClick={() => setTab("current")}>
          รอบการขายปัจจุบัน
        </button>
        <button type="button" className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>
          ประวัติรอบการขาย
        </button>
      </div>

      <div className="pos-module-content">
        {tab === "current" ? (
          selling && session ? (
            <>
              <h2>รอบการขายปัจจุบัน</h2>
              <dl className="pos-shift-dl">
                <div>
                  <dt>เวลาเปิดรอบ</dt>
                  <dd>{formatTs(session.openedAt)}</dd>
                </div>
                <div>
                  <dt>รหัสรอบ</dt>
                  <dd>#{session.id.slice(-4).toUpperCase()}</dd>
                </div>
                <div>
                  <dt>กะ</dt>
                  <dd>{shiftLabel}</dd>
                </div>
                <div>
                  <dt>ยอดขาย</dt>
                  <dd>฿{formatPlainNumber(session.totalSales)}</dd>
                </div>
                <div>
                  <dt>จำนวนบิล</dt>
                  <dd>{session.saleCount}</dd>
                </div>
                {sessionSummary ? (
                  <>
                    <div>
                      <dt>เงินสด</dt>
                      <dd>
                        {sessionSummary.cashCount} บิล · ฿{formatPlainNumber(sessionSummary.cashTotal)}
                      </dd>
                    </div>
                    <div>
                      <dt>PromptPay</dt>
                      <dd>
                        {sessionSummary.promptpayCount} บิล · ฿{formatPlainNumber(sessionSummary.promptpayTotal)}
                      </dd>
                    </div>
                  </>
                ) : null}
                <div>
                  <dt>เครื่อง</dt>
                  <dd>{device?.pairingCode}</dd>
                </div>
                {pendingSync > 0 ? (
                  <div>
                    <dt>ค้างส่ง</dt>
                    <dd className="pos-shift-warn">{pendingSync} บิล</dd>
                  </div>
                ) : null}
              </dl>
              <div className="pos-shift-actions">
                <button
                  type="button"
                  className="primary-btn pos-shift-close-btn"
                  disabled={closing || pendingSync > 0 || syncSnap.syncing}
                  onClick={() => void handleCloseShift()}
                >
                  {closing ? "กำลังปิด..." : pendingSync > 0 ? "รอซิงก์ก่อนปิดรอบ" : "ปิดรอบการขาย"}
                </button>
              </div>
            </>
          ) : session?.status === "closed" ? (
            <div className="pos-module-empty">
              <h2>รอบนี้ปิดแล้ว</h2>
              <p className="muted">
                ปิดเมื่อ {session.closedAt ? formatTs(session.closedAt) : "—"} · ยอด ฿
                {formatPlainNumber(session.totalSales)}
              </p>
              <p className="muted">เปิดรอบใหม่ที่ สั่งและชำระเงิน</p>
            </div>
          ) : (
            <div className="pos-module-empty">
              <h2>ยังไม่ได้เปิดรอบขาย</h2>
              <p className="muted">ไปที่ สั่งและชำระเงิน แล้วกดเปิดขายกะนี้</p>
            </div>
          )
        ) : history.length ? (
          <>
            <h2>ประวัติรอบการขาย (7 วัน)</h2>
            <ul className="pos-shift-history">
              {history.map((row) => (
                <li key={row.id} className="pos-shift-history-row">
                  <div className="pos-shift-history-head">
                    <strong>#{row.id.slice(-4).toUpperCase()}</strong>
                    <span>{labelOtShift(row.shift as "late" | "morning" | "evening")}</span>
                  </div>
                  <p className="muted">{formatTs(row.closedAt)}</p>
                  <p>
                    {row.saleCount} บิล · ฿{formatPlainNumber(row.totalSales)}
                  </p>
                  <p className="muted">
                    สด ฿{formatPlainNumber(row.cashTotal)} · PP ฿{formatPlainNumber(row.promptpayTotal)}
                  </p>
                </li>
              ))}
            </ul>
            <p className="muted pos-shift-history-note">
              รายงานเต็มที่ TellTea หลังร้าน → รายงานขาย POS
            </p>
          </>
        ) : (
          <div className="pos-module-empty">
            <h2>ประวัติรอบการขาย</h2>
            <p className="muted">ยังไม่มีรอบที่ปิดบนเครื่องนี้ (7 วันล่าสุด)</p>
          </div>
        )}
      </div>
    </div>
  );
}
