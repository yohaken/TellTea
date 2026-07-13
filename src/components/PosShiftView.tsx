"use client";

import { useEffect, useMemo, useState } from "react";
import { usePosApp } from "@/lib/pos-app-context";
import { seedDemoLocalReceipts, seedDemoLocalReceiptsIfEmpty } from "@/lib/pos-demo-receipts";
import {
  listLocalReceiptsForSession,
  listLocalReceiptsRecent,
  summarizeLocalReceipts,
  type PosLocalReceipt,
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

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "orange" | "green" | "blue" | "neutral";
}) {
  return (
    <div className={`pos-shift-kpi ${accent ? `pos-shift-kpi--${accent}` : ""}`}>
      <span className="pos-shift-kpi-label">{label}</span>
      <strong className="pos-shift-kpi-value">{value}</strong>
      {sub ? <span className="pos-shift-kpi-sub">{sub}</span> : null}
    </div>
  );
}

function PaymentBreakdown({
  cashCount,
  cashTotal,
  ppCount,
  ppTotal,
}: {
  cashCount: number;
  cashTotal: number;
  ppCount: number;
  ppTotal: number;
}) {
  const total = cashTotal + ppTotal || 1;
  const cashPct = Math.round((cashTotal / total) * 100);
  const ppPct = 100 - cashPct;

  return (
    <div className="pos-shift-pay-breakdown">
      <h3>ช่องทางชำระเงิน</h3>
      <div className="pos-shift-pay-bars">
        <div className="pos-shift-pay-bar pos-shift-pay-bar--cash" style={{ width: `${cashPct}%` }} />
        <div className="pos-shift-pay-bar pos-shift-pay-bar--pp" style={{ width: `${ppPct}%` }} />
      </div>
      <ul className="pos-shift-pay-list">
        <li>
          <span className="pos-shift-pay-dot pos-shift-pay-dot--cash" />
          <span>เงินสด</span>
          <span className="pos-shift-pay-meta">
            {cashCount} บิล · ฿{formatPlainNumber(cashTotal)}
          </span>
        </li>
        <li>
          <span className="pos-shift-pay-dot pos-shift-pay-dot--pp" />
          <span>PromptPay</span>
          <span className="pos-shift-pay-meta">
            {ppCount} บิล · ฿{formatPlainNumber(ppTotal)}
          </span>
        </li>
      </ul>
    </div>
  );
}

function FinancialTable({
  summary,
}: {
  summary: ReturnType<typeof summarizeLocalReceipts>;
}) {
  return (
    <div className="pos-shift-fin-table">
      <h3>สรุปยอด</h3>
      <dl>
        <div>
          <dt>ยอดขายสุทธิ</dt>
          <dd>฿{formatPlainNumber(summary.total)}</dd>
        </div>
        <div>
          <dt>เงินสด</dt>
          <dd>฿{formatPlainNumber(summary.cashTotal)}</dd>
        </div>
        <div>
          <dt>PromptPay</dt>
          <dd>฿{formatPlainNumber(summary.promptpayTotal)}</dd>
        </div>
        <div>
          <dt>จำนวนบิล</dt>
          <dd>{summary.count}</dd>
        </div>
        {summary.pendingCount > 0 ? (
          <div>
            <dt>รอส่งข้อมูล</dt>
            <dd className="pos-shift-warn">{summary.pendingCount} บิล</dd>
          </div>
        ) : null}
        {summary.voidedCount > 0 ? (
          <div>
            <dt>ทำลายแล้ว</dt>
            <dd>{summary.voidedCount} บิล</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function ReceiptRow({ receipt }: { receipt: PosLocalReceipt }) {
  const itemCount = receipt.lines?.reduce((n, l) => n + l.qty, 0) ?? 0;
  return (
    <div className={`pos-shift-sale-row ${receipt.voided ? "is-voided" : ""}`}>
      <div className="pos-shift-sale-head">
        <strong>#{receipt.billNo}</strong>
        <span>฿{formatPlainNumber(receipt.total)}</span>
      </div>
      <p className="muted">
        {formatTime(receipt.createdAt)}
        {itemCount > 0 ? ` · ${itemCount} รายการ` : ""}
        {receipt.paymentMethod === "cash" ? " · สด" : " · PP"}
        {receipt.voided ? " · ทำลาย" : receipt.pending ? " · รอส่ง" : ""}
      </p>
      {receipt.lines?.length ? (
        <ul className="pos-shift-sale-lines">
          {receipt.lines.slice(0, 4).map((line, i) => (
            <li key={i}>
              ×{line.qty} {line.name}
            </li>
          ))}
          {receipt.lines.length > 4 ? <li className="muted">… +{receipt.lines.length - 4} รายการ</li> : null}
        </ul>
      ) : (
        <p className="muted pos-shift-sale-preview">{receipt.linePreview}</p>
      )}
    </div>
  );
}

export function PosShiftView() {
  const { session, device, selling, shift, syncSnap, setError } = usePosApp();
  const [closing, setClosing] = useState(false);
  const [tab, setTab] = useState<"current" | "history">("current");
  const [historyRange, setHistoryRange] = useState<"today" | "week">("week");
  const [history, setHistory] = useState(() =>
    device ? listLocalSessionsForDevice(device.id) : [],
  );
  const [sales, setSales] = useState<PosLocalReceipt[]>(() => listLocalReceiptsRecent(7));
  const [demoMsg, setDemoMsg] = useState<string | null>(null);

  const shiftLabel = useMemo(() => labelOtShift(shift as "late" | "morning" | "evening"), [shift]);

  const sessionReceipts = useMemo(() => {
    if (!session) return [];
    return listLocalReceiptsForSession(session.id);
  }, [session]);

  const sessionSummary = useMemo(() => summarizeLocalReceipts(sessionReceipts), [sessionReceipts]);

  const pendingSync = syncSnap.pendingCount + syncSnap.failedCount;

  function refreshHistory() {
    if (device) setHistory(listLocalSessionsForDevice(device.id));
    setSales(listLocalReceiptsRecent(historyRange === "today" ? 1 : 7));
  }

  useEffect(() => {
    seedDemoLocalReceiptsIfEmpty(session?.id);
    refreshHistory();
    const t = window.setInterval(refreshHistory, 5000);
    return () => window.clearInterval(t);
  }, [device, session?.status, session?.id, historyRange]);

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

    const summary = sessionSummary;
    const zLines = [
      `ปิดรอบ #${session.id.slice(-4).toUpperCase()} · ${shiftLabel}`,
      `บิล ${summary.count} · ยอด ฿${formatPlainNumber(summary.total)}`,
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
      refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClosing(false);
    }
  }

  const salesSummary = useMemo(() => summarizeLocalReceipts(sales), [sales]);

  const displaySummary = tab === "current" && sessionSummary.count > 0 ? sessionSummary : salesSummary;

  function loadDemoData() {
    const result = seedDemoLocalReceipts(session?.id);
    setDemoMsg(`เพิ่มข้อมูลทดสอบ ${result.added} บิล`);
    refreshHistory();
  }

  return (
    <div className="pos-module pos-shift-module">
      <div className="pos-module-subnav pos-shift-subnav">
        <button type="button" className={tab === "current" ? "is-active" : ""} onClick={() => setTab("current")}>
          รอบการขายปัจจุบัน
        </button>
        <button type="button" className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>
          ประวัติการขาย
        </button>
        {tab === "history" ? (
          <div className="pos-shift-range-tabs">
            <button
              type="button"
              className={historyRange === "today" ? "is-active" : ""}
              onClick={() => setHistoryRange("today")}
            >
              วันนี้
            </button>
            <button
              type="button"
              className={historyRange === "week" ? "is-active" : ""}
              onClick={() => setHistoryRange("week")}
            >
              7 วัน
            </button>
          </div>
        ) : null}
        <button type="button" className="pos-shift-demo-btn" onClick={loadDemoData}>
          โหลดข้อมูลทดสอบ
        </button>
      </div>

      <div className="pos-module-content pos-shift-content">
        {demoMsg ? <p className="ok-text pos-shift-demo-msg">{demoMsg}</p> : null}

        {tab === "current" ? (
          selling && session ? (
            <>
              <div className="pos-shift-kpi-grid">
                <KpiCard
                  label="ยอดขายทั้งหมด"
                  value={`฿${formatPlainNumber(displaySummary.total || session.totalSales)}`}
                  sub={`${displaySummary.count || session.saleCount} บิล`}
                  accent="orange"
                />
                <KpiCard
                  label="เงินสด"
                  value={`฿${formatPlainNumber(displaySummary.cashTotal)}`}
                  sub={`${displaySummary.cashCount} บิล`}
                  accent="green"
                />
                <KpiCard
                  label="PromptPay"
                  value={`฿${formatPlainNumber(displaySummary.promptpayTotal)}`}
                  sub={`${displaySummary.promptpayCount} บิล`}
                  accent="blue"
                />
                <KpiCard
                  label="กะ"
                  value={shiftLabel}
                  sub={`#${session.id.slice(-4).toUpperCase()}`}
                  accent="neutral"
                />
              </div>

              <div className="pos-shift-report-grid">
                <PaymentBreakdown
                  cashCount={displaySummary.cashCount}
                  cashTotal={displaySummary.cashTotal}
                  ppCount={displaySummary.promptpayCount}
                  ppTotal={displaySummary.promptpayTotal}
                />
                <FinancialTable summary={displaySummary} />
              </div>

              <dl className="pos-shift-session-meta">
                <div>
                  <dt>เปิดรอบ</dt>
                  <dd>{formatTs(session.openedAt)}</dd>
                </div>
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

              {sessionReceipts.length ? (
                <div className="pos-shift-sales-block">
                  <h3>บิลในรอบนี้ ({sessionReceipts.length})</h3>
                  <div className="pos-shift-sales-list">
                    {sessionReceipts.map((receipt) => (
                      <ReceiptRow key={receipt.id} receipt={receipt} />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="pos-shift-actions">
                <button
                  type="button"
                  className="pos-btn-orange pos-shift-close-btn"
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
        ) : (
          <>
            <div className="pos-shift-kpi-grid">
              <KpiCard
                label="ยอดขายทั้งหมด"
                value={`฿${formatPlainNumber(salesSummary.total)}`}
                sub={`${salesSummary.count} บิล`}
                accent="orange"
              />
              <KpiCard
                label="เงินสด"
                value={`฿${formatPlainNumber(salesSummary.cashTotal)}`}
                sub={`${salesSummary.cashCount} บิล`}
                accent="green"
              />
              <KpiCard
                label="PromptPay"
                value={`฿${formatPlainNumber(salesSummary.promptpayTotal)}`}
                sub={`${salesSummary.promptpayCount} บิล`}
                accent="blue"
              />
              <KpiCard
                label="รอส่ง / ทำลาย"
                value={`${salesSummary.pendingCount} / ${salesSummary.voidedCount}`}
                sub={historyRange === "today" ? "วันนี้" : "7 วันล่าสุด"}
                accent="neutral"
              />
            </div>

            <div className="pos-shift-report-grid">
              <PaymentBreakdown
                cashCount={salesSummary.cashCount}
                cashTotal={salesSummary.cashTotal}
                ppCount={salesSummary.promptpayCount}
                ppTotal={salesSummary.promptpayTotal}
              />
              <FinancialTable summary={salesSummary} />
            </div>

            {sales.length ? (
              <div className="pos-shift-sales-block">
                <h3>รายการขาย ({sales.length})</h3>
                <div className="pos-shift-sales-list">
                  {sales.map((receipt) => (
                    <ReceiptRow key={receipt.id} receipt={receipt} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted pos-module-empty">ยังไม่มีบิล — กดโหลดข้อมูลทดสอบ</p>
            )}

            {history.length ? (
              <>
                <h3 className="pos-shift-history-subhead">รอบที่ปิดแล้ว</h3>
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
              </>
            ) : null}

            <p className="muted pos-shift-history-note">
              รายงานเต็มที่ TellTea หลังร้าน → รายงานขาย POS
            </p>
          </>
        )}
      </div>
    </div>
  );
}
