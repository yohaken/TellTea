"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, ChevronLeft, ChevronRight, MonitorSmartphone, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { labelOtShift } from "@/lib/ot";
import { voidPosSale } from "@/lib/pos-sales-admin";
import {
  formatPosReportDate,
  reconcilePosSessions,
  salesForSession,
  subscribePosSalesForDate,
  subscribePosSessionsForDate,
  summarizePosSalesDetailed,
  voidedForSession,
} from "@/lib/pos-sales-report";
import type { PosSale, PosSession } from "@/lib/types";
import { formatPlainNumber, startOfLocalDay } from "@/lib/utils";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import { PosManagePanel } from "@/components/PosManagePanel";

type PosSalesHubTab = "report" | "manage";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionShiftCard({
  session,
  sales,
  selected,
  onSelect,
}: {
  session: PosSession;
  sales: PosSale[];
  selected: boolean;
  onSelect: () => void;
}) {
  const active = salesForSession(sales, session.id);
  const voided = voidedForSession(sales, session.id);
  const cash = active.filter((s) => s.paymentMethod === "cash");
  const pp = active.filter((s) => s.paymentMethod === "promptpay");
  const salesTotal = active.reduce((sum, s) => sum + s.total, 0);
  const discount = active.reduce((sum, s) => sum + Math.max(0, s.discountBaht || 0), 0);
  const open = session.status === "open";
  const counted = session.closingCashCounted;
  const expected = session.expectedCash;
  const diff = session.cashDifference;
  const label = session.discrepancyLabel;

  return (
    <button
      type="button"
      className={`pos-session-card ${open ? "pos-session-card--open" : ""} ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="pos-session-card-head">
        <strong>
          {labelOtShift(session.shift as "late" | "morning" | "evening")} ·{" "}
          {open ? "กำลังเปิด" : "ปิดแล้ว"}
        </strong>
        <span className="muted">#{session.id.slice(-6).toUpperCase()}</span>
      </div>
      <p className="muted pos-session-card-time">
        เปิด {formatTs(session.openedAt)}
        {session.closedAt ? ` · ปิด ${formatTs(session.closedAt)}` : " · รันอยู่"}
      </p>
      <div className="pos-session-card-kpis">
        <span>
          ยอด ฿{formatPlainNumber(salesTotal || session.totalSales)}
        </span>
        <span>{active.length || session.saleCount} บิล</span>
        <span>สด ฿{formatPlainNumber(session.cashTotal ?? cash.reduce((a, s) => a + s.total, 0))}</span>
        <span>
          QR ฿{formatPlainNumber(session.promptpayTotal ?? pp.reduce((a, s) => a + s.total, 0))}
        </span>
      </div>
      {typeof session.openingCash === "number" ? (
        <p className="muted">เงินทอนเริ่ม ฿{formatPlainNumber(session.openingCash)}</p>
      ) : null}
      {!open && typeof session.leaveFloat === "number" ? (
        <p className="muted">ทอนรอบถัดไป ฿{formatPlainNumber(session.leaveFloat)}</p>
      ) : null}
      {!open && typeof counted === "number" ? (
        <p className="pos-session-card-diff">
          นับได้ ฿{formatPlainNumber(counted)}
          {typeof expected === "number" ? ` · ควรมี ฿${formatPlainNumber(expected)}` : ""}
          {typeof diff === "number"
            ? ` · ${label || "ส่วนต่าง"} ฿${formatPlainNumber(diff)}`
            : ""}
        </p>
      ) : null}
      {(discount > 0 || voided.length > 0 || (session.voidedCount || 0) > 0) && (
        <p className="muted">
          {discount > 0 ? `ส่วนลด ฿${formatPlainNumber(discount)}` : ""}
          {discount > 0 && (voided.length > 0 || (session.voidedCount || 0) > 0) ? " · " : ""}
          {voided.length > 0 || (session.voidedCount || 0) > 0
            ? `void ${voided.length || session.voidedCount}`
            : ""}
        </p>
      )}
      {session.discrepancyNote ? (
        <p className="muted">เหตุผล: {session.discrepancyNote}</p>
      ) : null}
      <span className="pos-session-card-hint">{selected ? "แสดงบิลรอบนี้ด้านล่าง" : "แตะเพื่อดูบิลในรอบ"}</span>
    </button>
  );
}

export function PosSalesReport({
  dateMs,
  onError,
  compact = false,
}: {
  dateMs: number;
  onError?: (msg: string | null) => void;
  compact?: boolean;
}) {
  const { actorId } = useAuth();
  const [sales, setSales] = useState<PosSale[]>([]);
  const [sessions, setSessions] = useState<PosSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<PosSale | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const isToday = dateMs === startOfLocalDay();

  useEffect(() => {
    setLoading(true);
    const unsubSales = subscribePosSalesForDate(
      dateMs,
      (list) => {
        setSales(list);
        setLoading(false);
      },
      (err) => {
        onError?.(err.message);
        setLoading(false);
      },
    );
    const unsubSessions = subscribePosSessionsForDate(
      dateMs,
      setSessions,
      (err) => onError?.(err.message),
    );
    return () => {
      unsubSales();
      unsubSessions();
    };
  }, [dateMs, onError]);

  const summary = useMemo(() => summarizePosSalesDetailed(sales), [sales]);
  const reconcile = useMemo(() => reconcilePosSessions(sales, sessions), [sales, sessions]);
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.openedAt - a.openedAt),
    [sessions],
  );
  const filteredSales = useMemo(() => {
    if (!selectedSessionId) return sales;
    return sales.filter((s) => s.sessionId === selectedSessionId);
  }, [sales, selectedSessionId]);

  useEffect(() => {
    setSelectedSessionId(null);
  }, [dateMs]);

  function openVoidDialog(sale: PosSale) {
    if (!actorId || sale.status === "voided") return;
    setVoidReason("");
    setVoidTarget(sale);
  }

  async function confirmVoid() {
    if (!actorId || !voidTarget) return;
    const sale = voidTarget;
    setBusyId(sale.id);
    onError?.(null);
    try {
      await voidPosSale(sale.id, actorId, voidReason.trim() || undefined);
      setVoidTarget(null);
    } catch (err) {
      onError?.((err as Error).message || "ยกเลิกบิลไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={compact ? "" : "pos-sales-report"}>
      {!compact ? (
        <p className="muted pos-sales-report-date">{formatPosReportDate(dateMs)}</p>
      ) : null}

      <div className="pos-sales-summary-grid">
        <div className="pos-sales-summary-card pos-sales-summary-card--total">
          <span className="pos-sales-summary-label">ยอดขายสุทธิ</span>
          <strong>฿{formatPlainNumber(summary.total)}</strong>
          <span className="muted">{summary.activeCount} บิล</span>
        </div>
        {summary.discountTotal > 0 ? (
          <div className="pos-sales-summary-card">
            <span className="pos-sales-summary-label">ส่วนลด</span>
            <strong>-฿{formatPlainNumber(summary.discountTotal)}</strong>
            <span className="muted">
              {summary.discountCount} บิล · ก่อนลด ฿{formatPlainNumber(summary.grossTotal)}
            </span>
          </div>
        ) : null}
        <div className="pos-sales-summary-card">
          <span className="pos-sales-summary-label">เงินสด</span>
          <strong>฿{formatPlainNumber(summary.cashTotal)}</strong>
          <span className="muted">{summary.cashCount} บิล</span>
        </div>
        <div className="pos-sales-summary-card">
          <span className="pos-sales-summary-label">PromptPay</span>
          <strong>฿{formatPlainNumber(summary.promptpayTotal)}</strong>
          <span className="muted">{summary.promptpayCount} บิล</span>
        </div>
        <div className="pos-sales-summary-card pos-sales-summary-card--void">
          <span className="pos-sales-summary-label">ยกเลิก</span>
          <strong>฿{formatPlainNumber(summary.voidedTotal)}</strong>
          <span className="muted">{summary.voidedCount} บิล</span>
        </div>
      </div>

      <section className="pos-sales-report-section">
        <h3>แยกตามกะ</h3>
        <div className="sheet-wrap">
          <table className="sheet-table pos-sales-shift-table">
            <thead>
              <tr>
                <th>กะ</th>
                <th className="col-num">บิล</th>
                <th className="col-num">เงินสด</th>
                <th className="col-num">PromptPay</th>
                <th className="col-num">รวม</th>
              </tr>
            </thead>
            <tbody>
              {summary.byShift.map((row) => (
                <tr key={row.shift}>
                  <td>{row.label}</td>
                  <td className="col-num">{row.count || "—"}</td>
                  <td className="col-num">{row.cashTotal ? formatPlainNumber(row.cashTotal) : "—"}</td>
                  <td className="col-num">
                    {row.promptpayTotal ? formatPlainNumber(row.promptpayTotal) : "—"}
                  </td>
                  <td className="col-num">{row.total ? formatPlainNumber(row.total) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {summary.topItems.length > 0 ? (
        <section className="pos-sales-report-section">
          <h3>เมนูขายดี</h3>
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>เมนู</th>
                  <th className="col-num">จำนวน</th>
                  <th className="col-num">ยอด</th>
                </tr>
              </thead>
              <tbody>
                {summary.topItems.map((item) => (
                  <tr key={item.menuItemId || item.name}>
                    <td>{item.name}</td>
                    <td className="col-num">{item.qty}</td>
                    <td className="col-num">{formatPlainNumber(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {sortedSessions.length > 0 ? (
        <section className="pos-sales-report-section">
          <h3>การ์ดรอบขาย (ดูอย่างเดียว · ปิดกะทำบน nPos)</h3>
          <p className="muted pos-session-cards-hint">
            ยอดรันระหว่างกะ + หลังปิดกะ (เงินทอน / นับได้ / Over-Short) จาก sync
          </p>
          <div className="pos-session-cards">
            {sortedSessions.map((session) => (
              <SessionShiftCard
                key={session.id}
                session={session}
                sales={sales}
                selected={selectedSessionId === session.id}
                onSelect={() =>
                  setSelectedSessionId((cur) => (cur === session.id ? null : session.id))
                }
              />
            ))}
          </div>
          {reconcile.some((r) => !r.countMatch || !r.totalMatch) ? (
            <p className="muted pos-sales-reconcile-warn-note">
              มีรอบที่ตัวเลข session กับบิลไม่ตรง — ดูการ์ด + รายบิลด้านล่าง
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="pos-sales-report-section">
        <h3>
          รายการบิล{isToday ? " วันนี้" : ""}
          {selectedSessionId
            ? ` · รอบ #${selectedSessionId.slice(-6).toUpperCase()}`
            : ""}
        </h3>
        {selectedSessionId ? (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setSelectedSessionId(null)}
          >
            แสดงทุกบิลวันนี้
          </button>
        ) : null}
        {loading ? <p className="empty">กำลังโหลด...</p> : null}
        {!loading && filteredSales.length === 0 ? (
          <p className="muted">ยังไม่มีบิล — ขายที่แท็บเล็ต POS</p>
        ) : null}
        {!loading && filteredSales.length > 0 ? (
          <ul className="pos-sales-list">
            {filteredSales.map((sale) => {
              const voided = sale.status === "voided";
              const busy = busyId === sale.id;
              const preview = sale.lines
                .slice(0, 2)
                .map((l) => `${l.name}×${l.qty}`)
                .join(", ");
              return (
                <li key={sale.id} className={`pos-sales-row ${voided ? "pos-sales-row--void" : ""}`}>
                  <div className="pos-sales-row-main">
                    <strong>{sale.billNo}</strong>
                    <span className="muted">
                      {formatTime(sale.createdAt)} · {labelOtShift(sale.shift as "late" | "morning" | "evening")} ·{" "}
                      {sale.paymentMethod === "promptpay" ? "PromptPay" : "เงินสด"}
                      {(sale.discountBaht || 0) > 0
                        ? ` · ส่วนลด ฿${formatPlainNumber(sale.discountBaht || 0)}`
                        : ""}
                    </span>
                    <span className="pos-sales-row-items">{preview}</span>
                    {sale.voidReason ? (
                      <span className="muted">เหตุผล: {sale.voidReason}</span>
                    ) : null}
                  </div>
                  <div className="pos-sales-row-end">
                    <strong className={voided ? "muted" : ""}>฿{formatPlainNumber(sale.total)}</strong>
                    {!voided && isToday ? (
                      <button
                        type="button"
                        className="ghost-btn pos-sales-void-btn"
                        disabled={busy}
                        onClick={() => openVoidDialog(sale)}
                      >
                        <Ban size={14} aria-hidden />
                        ยกเลิก
                      </button>
                    ) : voided ? (
                      <span className="pos-sales-voided">ยกเลิกแล้ว</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <PosConfirmDialog
        open={voidTarget !== null}
        title={voidTarget ? `ยกเลิกบิล ${voidTarget.billNo}?` : ""}
        message={voidTarget ? `ยอด ฿${formatPlainNumber(voidTarget.total)}` : undefined}
        variant="prompt"
        promptLabel="เหตุผล"
        promptPlaceholder="ไม่บังคับ"
        promptValue={voidReason}
        onPromptChange={setVoidReason}
        confirmLabel="ยืนยันยกเลิก"
        destructive
        busy={voidTarget !== null && busyId === voidTarget.id}
        onCancel={() => setVoidTarget(null)}
        onConfirm={() => void confirmVoid()}
      />
    </div>
  );
}

export function PosSalesReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: PosSalesHubTab = tabParam === "manage" ? "manage" : "report";
  const [dateMs, setDateMs] = useState(() => startOfLocalDay());
  const [error, setError] = useState<string | null>(null);
  const today = startOfLocalDay();

  function setTab(next: PosSalesHubTab) {
    setError(null);
    router.replace(next === "manage" ? "/pos-sales/?tab=manage" : "/pos-sales/", { scroll: false });
  }

  function shiftDate(delta: number) {
    const next = new Date(dateMs);
    next.setDate(next.getDate() + delta);
    const nextMs = startOfLocalDay(next);
    if (nextMs > today) return;
    setDateMs(nextMs);
  }

  return (
    <div className="module-page pos-sales-report-page">
      <h1 className="panel-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Receipt size={20} aria-hidden />
        POS
      </h1>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        รายงานยอดขาย POS — เฉพาะเจ้าของ · ขายหน้าร้านใช้แอป nPos
        (แท็บจัดการ: ตั้งค่าร้าน · เครื่อง nPos · ไทม์ไลน์)
      </p>

      <div className="stock-owner-tabs" role="tablist" aria-label="หมวด POS">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "report"}
          className={tab === "report" ? "stock-owner-tab is-active" : "stock-owner-tab"}
          onClick={() => setTab("report")}
        >
          <Receipt size={15} aria-hidden />
          รายงานยอดขาย
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manage"}
          className={tab === "manage" ? "stock-owner-tab is-active" : "stock-owner-tab"}
          onClick={() => setTab("manage")}
        >
          <MonitorSmartphone size={15} aria-hidden />
          จัดการ Pos
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {tab === "manage" ? (
        <PosManagePanel onError={setError} />
      ) : (
        <>
          <div className="pos-sales-date-nav">
            <button type="button" className="ghost-btn" aria-label="วันก่อนหน้า" onClick={() => shiftDate(-1)}>
              <ChevronLeft size={18} aria-hidden />
            </button>
            <strong>{formatPosReportDate(dateMs)}</strong>
            <button
              type="button"
              className="ghost-btn"
              aria-label="วันถัดไป"
              disabled={dateMs >= today}
              onClick={() => shiftDate(1)}
            >
              <ChevronRight size={18} aria-hidden />
            </button>
            {dateMs !== today ? (
              <button type="button" className="ghost-btn" onClick={() => setDateMs(today)}>
                วันนี้
              </button>
            ) : null}
          </div>
          <PosSalesReport dateMs={dateMs} onError={setError} />
        </>
      )}
    </div>
  );
}

export function PosSalesReportLink() {
  return (
    <Link href="/pos-sales/" className="ghost-btn pos-sales-report-link">
      ดูรายงานเต็ม →
    </Link>
  );
}
