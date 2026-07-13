"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePosApp } from "@/lib/pos-app-context";
import { seedDemoLocalReceipts, seedDemoLocalReceiptsIfEmpty } from "@/lib/pos-demo-receipts";
import {
  listLocalReceiptsForSession,
  listLocalReceiptsRecent,
  summarizeLocalReceipts,
  type PosLocalReceipt,
} from "@/lib/pos-local-receipts";
import { listLocalSessionsForDevice } from "@/lib/pos-local-sessions";
import { formatPosSessionClock } from "@/lib/pos-session";
import { PosReceiptPaper } from "@/components/PosReceiptPaper";
import { printSaleDocuments } from "@/lib/pos-printer/router";
import { localReceiptToPrintPayload } from "@/lib/pos-receipt-view";
import { getLocalPosShopSettings, subscribePosShopSettings, type PosShopSettings } from "@/lib/pos-settings";
import { formatPlainNumber } from "@/lib/utils";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import { buildShiftReportPayload } from "@/lib/pos-shift-report";
import {
  buildShiftReportHtml,
  openShiftReportPrint,
} from "@/lib/pos-printer/shift-snapshot-template";
import { loadPosMenuCache } from "@/lib/pos-menu-cache";
import type { PosLocalSessionRecord } from "@/lib/pos-local-sessions";

const DEFAULT_SHOP: PosShopSettings = getLocalPosShopSettings();

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

function formatElapsed(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useLiveElapsed(startedAt: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (startedAt == null) return "—";
  return formatElapsed(now - startedAt);
}

function ShiftStatusTable({
  openedAt,
  elapsed,
  pairingCode,
  pendingSync,
  saleCount,
}: {
  openedAt: number;
  elapsed: string;
  pairingCode?: string;
  pendingSync: number;
  saleCount: number;
}) {
  return (
    <table className="pos-shift-status-table">
      <tbody>
        <tr>
          <th scope="row">สถานะรอบ</th>
          <td>
            <span className="pos-shift-status-pill">กำลังเปิด</span>
          </td>
        </tr>
        <tr>
          <th scope="row">เริ่มรอบ</th>
          <td>{formatTs(openedAt)}</td>
        </tr>
        <tr>
          <th scope="row">เวลานับเดิน</th>
          <td className="pos-shift-elapsed">{elapsed}</td>
        </tr>
        <tr>
          <th scope="row">บิลในรอบ</th>
          <td>{saleCount}</td>
        </tr>
        {pairingCode ? (
          <tr>
            <th scope="row">เครื่อง</th>
            <td>{pairingCode}</td>
          </tr>
        ) : null}
        {pendingSync > 0 ? (
          <tr>
            <th scope="row">ค้างส่ง</th>
            <td className="pos-shift-warn">{pendingSync} บิล</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
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

function ReceiptRow({
  receipt,
  selected,
  expanded,
  onTap,
}: {
  receipt: PosLocalReceipt;
  selected: boolean;
  expanded: boolean;
  onTap: () => void;
}) {
  const itemCount = receipt.lines?.reduce((n, l) => n + l.qty, 0) ?? 0;
  return (
    <button
      type="button"
      className={`pos-shift-sale-row ${receipt.voided ? "is-voided" : ""} ${selected ? "is-selected" : ""} ${expanded ? "is-expanded" : ""}`}
      onClick={onTap}
    >
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
          {receipt.lines.slice(0, 3).map((line, i) => (
            <li key={i}>
              <strong>×{line.qty}</strong> {line.name}
            </li>
          ))}
          {receipt.lines.length > 3 ? <li className="muted">… +{receipt.lines.length - 3} รายการ</li> : null}
        </ul>
      ) : (
        <p className="muted pos-shift-sale-preview">{receipt.linePreview}</p>
      )}
      <span className="pos-shift-sale-hint">
        {expanded ? "แตะอีกครั้งเพื่อปิดใบเสร็จ" : selected ? "แตะอีกครั้งเพื่อดูใบเสร็จ" : "แตะเพื่อเลือกบิล"}
      </span>
    </button>
  );
}

export function PosShiftView() {
  const { session, device, selling, syncSnap, setError, handleCloseShift: closeShiftFromApp } = usePosApp();
  const elapsed = useLiveElapsed(selling && session ? session.openedAt : null);
  const [closing, setClosing] = useState(false);
  const [closeShiftDetail, setCloseShiftDetail] = useState<string | null>(null);
  const [tab, setTab] = useState<"current" | "history">("current");
  const [historyRange, setHistoryRange] = useState<"today" | "week">("week");
  const [history, setHistory] = useState(() =>
    device ? listLocalSessionsForDevice(device.id) : [],
  );
  const [sales, setSales] = useState<PosLocalReceipt[]>(() => listLocalReceiptsRecent(7));
  const [demoMsg, setDemoMsg] = useState<string | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [shop, setShop] = useState<PosShopSettings>(DEFAULT_SHOP);
  const [refreshTick, setRefreshTick] = useState(0);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  const [printingReport, setPrintingReport] = useState(false);
  const shiftScrollRef = useRef<HTMLDivElement | null>(null);
  const receiptPanelRef = useRef<HTMLDivElement | null>(null);
  const lastTapRef = useRef({ id: "", time: 0 });

  const sessionReceipts = useMemo(() => {
    if (!session) return [];
    return listLocalReceiptsForSession(session.id);
  }, [session, refreshTick]);

  const sessionSummary = useMemo(() => summarizeLocalReceipts(sessionReceipts), [sessionReceipts]);

  const pendingSync = syncSnap.pendingCount + syncSnap.failedCount;

  const activeReceipts = tab === "current" ? sessionReceipts : sales;
  const selectedReceipt = useMemo(
    () => activeReceipts.find((r) => r.id === expandedReceiptId) || null,
    [activeReceipts, expandedReceiptId],
  );

  useEffect(() => {
    const unsub = subscribePosShopSettings(setShop);
    return unsub;
  }, []);

  function scrollReceiptIntoView() {
    window.setTimeout(() => {
      const panel = receiptPanelRef.current;
      const scroller = shiftScrollRef.current;
      if (!panel) return;
      if (scroller) {
        const panelRect = panel.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        if (panelRect.bottom > scrollerRect.bottom - 8) {
          scroller.scrollBy({
            top: panelRect.bottom - scrollerRect.bottom + 20,
            behavior: "smooth",
          });
        } else if (panelRect.top < scrollerRect.top + 8) {
          scroller.scrollBy({
            top: panelRect.top - scrollerRect.top - 20,
            behavior: "smooth",
          });
        }
        return;
      }
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  }

  function handleReceiptTap(receipt: PosLocalReceipt) {
    const now = Date.now();
    const last = lastTapRef.current;
    const isRepeat = last.id === receipt.id && now - last.time < 700;
    lastTapRef.current = { id: receipt.id, time: now };

    if (expandedReceiptId === receipt.id) {
      setExpandedReceiptId(null);
      setSelectedReceiptId(null);
      return;
    }

    if (selectedReceiptId === receipt.id && isRepeat) {
      setExpandedReceiptId(receipt.id);
      scrollReceiptIntoView();
      return;
    }

    setSelectedReceiptId(receipt.id);
    if (isRepeat) {
      setExpandedReceiptId(receipt.id);
      scrollReceiptIntoView();
    } else {
      setExpandedReceiptId(null);
    }
  }

  async function handlePrintReceipt(receipt: PosLocalReceipt) {
    const payload = localReceiptToPrintPayload(
      receipt,
      shop,
      device?.pairingCode || device?.id.slice(-6).toUpperCase(),
    );
    await printSaleDocuments(payload, { receiptOnly: true });
  }

  function printShiftReport(opts: {
    kind: "snapshot" | "close";
    sessionId: string;
    openedAt: number;
    closedAt?: number | null;
    summary: ReturnType<typeof summarizeLocalReceipts>;
    receipts?: PosLocalReceipt[];
  }) {
    setPrintingReport(true);
    setPrintMsg(null);
    try {
      const menu = loadPosMenuCache({ withImages: false });
      const payload = buildShiftReportPayload({
        kind: opts.kind,
        shop,
        deviceCode: device?.pairingCode || device?.id.slice(-6).toUpperCase() || "—",
        sessionId: opts.sessionId,
        openedAt: opts.openedAt,
        closedAt: opts.closedAt,
        summary: opts.summary,
        receipts: opts.receipts,
        menu: menu
          ? { items: menu.items, categories: menu.categories }
          : undefined,
      });
      const ok = openShiftReportPrint(buildShiftReportHtml(payload));
      setPrintMsg(
        ok
          ? opts.kind === "close"
            ? "เปิดหน้าต่างพิมพ์รายงานยอดการขายแล้ว"
            : "เปิดหน้าต่างพิมพ์สรุปกะแล้ว"
          : "เปิดหน้าต่างพิมพ์ไม่ได้ — อนุญาต popup",
      );
    } catch (err) {
      setPrintMsg((err as Error).message);
    } finally {
      setPrintingReport(false);
    }
  }

  function handlePrintCurrentSnapshot() {
    if (!session) return;
    printShiftReport({
      kind: "snapshot",
      sessionId: session.id,
      openedAt: session.openedAt,
      summary: sessionSummary,
      receipts: sessionReceipts,
    });
  }

  function handlePrintClosedSession(row: PosLocalSessionRecord) {
    const receipts = listLocalReceiptsForSession(row.id);
    const summary =
      receipts.length > 0
        ? summarizeLocalReceipts(receipts)
        : {
            count: row.saleCount,
            total: row.totalSales,
            cashCount: 0,
            cashTotal: row.cashTotal ?? 0,
            promptpayCount: 0,
            promptpayTotal: row.promptpayTotal ?? 0,
            pendingCount: 0,
            voidedCount: 0,
          };
    printShiftReport({
      kind: "close",
      sessionId: row.id,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      summary,
      receipts,
    });
  }

  function handlePrintHistoryRange() {
    printShiftReport({
      kind: "snapshot",
      sessionId: `history-${historyRange}`,
      openedAt: sales[sales.length - 1]?.createdAt ?? Date.now(),
      summary: summarizeLocalReceipts(sales),
      receipts: sales,
    });
  }

  function refreshHistory() {
    if (device) setHistory(listLocalSessionsForDevice(device.id));
    setSales(listLocalReceiptsRecent(historyRange === "today" ? 1 : 7));
    setRefreshTick((n) => n + 1);
  }

  useEffect(() => {
    setSelectedReceiptId(null);
    setExpandedReceiptId(null);
  }, [tab, historyRange]);

  useEffect(() => {
    seedDemoLocalReceiptsIfEmpty(session?.id);
    refreshHistory();
    const t = window.setInterval(refreshHistory, 5000);
    return () => window.clearInterval(t);
  }, [device, session?.status, session?.id, historyRange]);

  function requestCloseShift() {
    if (!session || !selling || !device) return;

    const summary = sessionSummary;
    const zLines = [
      `ออกงาน #${session.id.slice(-4).toUpperCase()}`,
      `เข้า ${formatPosSessionClock(session.openedAt)}`,
      `บิล ${summary.count} · ยอด ฿${formatPlainNumber(summary.total)}`,
      `เงินสด ${summary.cashCount} ฿${formatPlainNumber(summary.cashTotal)}`,
      `PromptPay ${summary.promptpayCount} ฿${formatPlainNumber(summary.promptpayTotal)}`,
      pendingSync > 0 ? `บิลค้างส่ง ${pendingSync} — จะซิงก์เบื้องหลัง` : "",
    ]
      .filter(Boolean)
      .join("\n");

    setCloseShiftDetail(zLines);
  }

  async function handleCloseShift() {
    if (!session || !device) return;

    const closedSummary = sessionSummary;
    const closedOpenedAt = session.openedAt;
    const closedSessionId = session.id;
    const closedReceipts = sessionReceipts;

    setClosing(true);
    setError(null);
    try {
      await closeShiftFromApp({
        cashTotal: closedSummary.cashTotal,
        promptpayTotal: closedSummary.promptpayTotal,
      });
      refreshHistory();
      setCloseShiftDetail(null);
      printShiftReport({
        kind: "close",
        sessionId: closedSessionId,
        openedAt: closedOpenedAt,
        closedAt: Date.now(),
        summary: closedSummary,
        receipts: closedReceipts,
      });
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
        {printMsg ? <p className="ok-text pos-shift-demo-msg">{printMsg}</p> : null}

        {tab === "current" ? (
          selling && session ? (
            <>
              <div className="pos-shift-sticky-top">
                <ShiftStatusTable
                  openedAt={session.openedAt}
                  elapsed={elapsed}
                  pairingCode={device?.pairingCode}
                  pendingSync={pendingSync}
                  saleCount={displaySummary.count || session.saleCount}
                />
                <div className="pos-shift-sticky-actions">
                  <button
                    type="button"
                    className="pos-shift-snapshot-btn"
                    disabled={printingReport}
                    onClick={handlePrintCurrentSnapshot}
                  >
                    {printingReport ? "กำลังพิมพ์..." : "พิมพ์สรุปกลางรอบ"}
                  </button>
                  <button
                    type="button"
                    className="pos-btn-orange pos-shift-close-btn"
                    disabled={closing}
                    onClick={requestCloseShift}
                  >
                    {closing ? "กำลังบันทึก..." : "ออกงาน (ปิดรอบ)"}
                  </button>
                </div>
              </div>

              <div className="pos-shift-scroll" ref={shiftScrollRef}>
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
                    label="เข้างาน"
                    value={formatPosSessionClock(session.openedAt)}
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

                {sessionReceipts.length ? (
                  <div className="pos-shift-sales-block">
                    <h3>บิลในรอบนี้ ({sessionReceipts.length})</h3>
                    <div className="pos-shift-sales-list">
                      {sessionReceipts.map((receipt) => (
                        <ReceiptRow
                          key={receipt.id}
                          receipt={receipt}
                          selected={selectedReceiptId === receipt.id}
                          expanded={expandedReceiptId === receipt.id}
                          onTap={() => handleReceiptTap(receipt)}
                        />
                      ))}
                    </div>
                    {selectedReceipt && tab === "current" ? (
                      <div className="pos-shift-receipt-inline" ref={receiptPanelRef}>
                        <PosReceiptPaper
                          receipt={selectedReceipt}
                          compact
                          onPrint={() => void handlePrintReceipt(selectedReceipt)}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : session?.status === "closed" ? (
            <div className="pos-module-empty">
              <h2>รอบนี้ปิดแล้ว</h2>
              <p className="muted">
                ปิดเมื่อ {session.closedAt ? formatTs(session.closedAt) : "—"} · ยอด ฿
                {formatPlainNumber(session.totalSales)}
              </p>
              <p className="muted">กดเข้างานใหม่ที่ สั่งและชำระเงิน</p>
            </div>
          ) : (
            <div className="pos-module-empty">
              <h2>ยังไม่ได้เข้างาน</h2>
              <p className="muted">ไปที่ สั่งและชำระเงิน แล้วกดเข้างาน</p>
            </div>
          )
        ) : (
          <>
            <div className="pos-shift-history-sticky">
              <p className="pos-shift-history-sticky-label">
                สรุปรายการ{historyRange === "today" ? "วันนี้" : "7 วัน"} · {salesSummary.count} บิล · ฿
                {formatPlainNumber(salesSummary.total)}
              </p>
              <button
                type="button"
                className="pos-shift-snapshot-btn"
                disabled={printingReport || salesSummary.count === 0}
                onClick={handlePrintHistoryRange}
              >
                {printingReport ? "กำลังพิมพ์..." : "พิมพ์สรุปช่วงนี้"}
              </button>
            </div>

            <div className="pos-shift-scroll" ref={shiftScrollRef}>
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
                    <ReceiptRow
                      key={receipt.id}
                      receipt={receipt}
                      selected={selectedReceiptId === receipt.id}
                      expanded={expandedReceiptId === receipt.id}
                      onTap={() => handleReceiptTap(receipt)}
                    />
                  ))}
                </div>
                {selectedReceipt && tab === "history" ? (
                  <div className="pos-shift-receipt-inline" ref={receiptPanelRef}>
                    <PosReceiptPaper
                      receipt={selectedReceipt}
                      compact
                      onPrint={() => void handlePrintReceipt(selectedReceipt)}
                    />
                  </div>
                ) : null}
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
                        <span>
                          {formatPosSessionClock(row.openedAt)}
                          {row.closedAt ? ` → ${formatPosSessionClock(row.closedAt)}` : ""}
                        </span>
                      </div>
                      <p className="muted">{formatTs(row.closedAt)}</p>
                      <p>
                        {row.saleCount} บิล · ฿{formatPlainNumber(row.totalSales)}
                      </p>
                      <p className="muted">
                        สด ฿{formatPlainNumber(row.cashTotal)} · PP ฿{formatPlainNumber(row.promptpayTotal)}
                      </p>
                      <button
                        type="button"
                        className="pos-shift-session-print-btn"
                        disabled={printingReport}
                        onClick={() => handlePrintClosedSession(row)}
                      >
                        พิมพ์สรุปกะนี้
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <p className="muted pos-shift-history-note">
              รายงานเต็มที่ TellTea หลังร้าน → รายงานขาย POS
            </p>
            </div>
          </>
        )}
      </div>

      <PosConfirmDialog
        open={closeShiftDetail !== null}
        title="ออกงาน (ปิดรอบขาย)?"
        detail={closeShiftDetail ?? undefined}
        confirmLabel="ออกงาน"
        destructive
        busy={closing}
        onCancel={() => !closing && setCloseShiftDetail(null)}
        onConfirm={() => void handleCloseShift()}
      />
    </div>
  );
}
