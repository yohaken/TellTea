"use client";

import { useEffect, useMemo, useState, type UIEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { closePosSessionAdmin, voidPosSale } from "@/lib/pos-sales-admin";
import {
  POS_BILLS_SLIM_PAGE,
  inspectPosSessionData,
  posSessionCode,
  shortPosSessionId,
  subscribePosSalesRecent,
  subscribePosSessionsRecent,
  summarizePosSalesDetailed,
} from "@/lib/pos-sales-report";
import {
  saleLinesToLocalReceiptLines,
  type PosLocalReceipt,
} from "@/lib/pos-local-receipts";
import type { PosSale, PosSession } from "@/lib/types";
import { formatPlainNumber, startOfLocalDay } from "@/lib/utils";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import { PosManagePanel } from "@/components/PosManagePanel";
import { PosReceiptPaper } from "@/components/PosReceiptPaper";
import { PosSessionsSlimTable } from "@/components/PosSessionsSlimTable";

function saleToLocalReceipt(sale: PosSale): PosLocalReceipt {
  const extra = sale as PosSale & {
    customerName?: string;
    customerPhone?: string;
    staffName?: string;
    vatBaht?: number;
    serviceChargeBaht?: number;
  };
  return {
    id: sale.id,
    billNo: sale.billNo,
    sessionId: sale.sessionId,
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    linePreview: sale.lines.map((l) => `${l.name}×${l.qty}`).join(", "),
    lines: saleLinesToLocalReceiptLines(sale.lines),
    discountBaht: sale.discountBaht,
    cashReceived: sale.cashReceived,
    change: sale.change,
    createdAt: sale.createdAt,
    pending: false,
    voided: sale.status === "voided",
    voidedAt: sale.voidedAt,
    voidReason: sale.voidReason,
    customerName: extra.customerName,
    customerPhone: extra.customerPhone,
    staffName: extra.staffName,
    vatBaht: extra.vatBaht,
    serviceChargeBaht: extra.serviceChargeBaht,
  };
}

type BillStatusFilter = "all" | "ok" | "voided";
type BillPayFilter = "all" | "cash" | "promptpay" | "transfer";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function saleIsToday(sale: PosSale, todayMs: number): boolean {
  if (sale.date === todayMs) return true;
  return startOfLocalDay(new Date(sale.createdAt || 0)) === todayMs;
}

type PosSalesHubTab = "report" | "manage";

export function PosSalesReport({
  onError,
  compact = false,
}: {
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
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [billQuery, setBillQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BillStatusFilter>("all");
  const [payFilter, setPayFilter] = useState<BillPayFilter>("all");
  const [billsVisible, setBillsVisible] = useState(POS_BILLS_SLIM_PAGE);
  const [forceCloseBusyId, setForceCloseBusyId] = useState<string | null>(null);
  const [forceCloseTargetId, setForceCloseTargetId] = useState<string | null>(null);
  const [billsOpen, setBillsOpen] = useState(false);

  const todayMs = startOfLocalDay();

  useEffect(() => {
    setLoading(true);
    const unsubSales = subscribePosSalesRecent(
      (list) => {
        setSales(list);
        setLoading(false);
      },
      (err) => {
        onError?.(err.message);
        setLoading(false);
      },
    );
    const unsubSessions = subscribePosSessionsRecent(
      setSessions,
      (err) => onError?.(err.message),
    );
    return () => {
      unsubSales();
      unsubSessions();
    };
  }, [onError]);

  const summary = useMemo(() => summarizePosSalesDetailed(sales, sessions), [sales, sessions]);
  const dataIssues = useMemo(() => inspectPosSessionData(sessions, sales), [sessions, sales]);
  const filteredSales = useMemo(() => {
    let list = selectedSessionId
      ? sales.filter((s) => s.sessionId === selectedSessionId)
      : sales;
    if (statusFilter === "ok") list = list.filter((s) => s.status !== "voided");
    if (statusFilter === "voided") list = list.filter((s) => s.status === "voided");
    if (payFilter === "cash") list = list.filter((s) => s.paymentMethod === "cash");
    if (payFilter === "promptpay") list = list.filter((s) => s.paymentMethod === "promptpay");
    if (payFilter === "transfer") list = list.filter((s) => s.paymentMethod === "transfer");
    const q = billQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => {
        const extra = s as PosSale & {
          customerName?: string;
          customerPhone?: string;
          staffName?: string;
        };
        return (
          (s.billNo || "").toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (extra.customerName || "").toLowerCase().includes(q) ||
          (extra.customerPhone || "").toLowerCase().includes(q) ||
          (extra.staffName || "").toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [sales, selectedSessionId, billQuery, statusFilter, payFilter]);

  const selectedSale = useMemo(
    () => filteredSales.find((s) => s.id === selectedSaleId) || filteredSales[0] || null,
    [filteredSales, selectedSaleId],
  );

  const visibleSales = useMemo(
    () => filteredSales.slice(0, billsVisible),
    [filteredSales, billsVisible],
  );

  useEffect(() => {
    setBillsVisible(POS_BILLS_SLIM_PAGE);
  }, [selectedSessionId, statusFilter, payFilter, billQuery]);

  useEffect(() => {
    if (selectedSaleId && !filteredSales.some((s) => s.id === selectedSaleId)) {
      setSelectedSaleId(filteredSales[0]?.id || null);
    }
  }, [filteredSales, selectedSaleId]);

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

  const forceCloseTarget = useMemo(
    () => (forceCloseTargetId ? sessions.find((s) => s.id === forceCloseTargetId) || null : null),
    [forceCloseTargetId, sessions],
  );

  async function confirmForceClose() {
    if (!actorId || !forceCloseTargetId) return;
    const sid = forceCloseTargetId;
    setForceCloseBusyId(sid);
    onError?.(null);
    try {
      await closePosSessionAdmin(sid, actorId);
      setForceCloseTargetId(null);
    } catch (err) {
      onError?.((err as Error).message || "ปิดรอบไม่สำเร็จ");
    } finally {
      setForceCloseBusyId(null);
    }
  }

  function onBillsScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 48) return;
    if (billsVisible >= filteredSales.length) return;
    setBillsVisible((n) => Math.min(filteredSales.length, n + POS_BILLS_SLIM_PAGE));
  }

  function payLabel(method: string | undefined): string {
    if (method === "promptpay") return "PP";
    if (method === "transfer") return "โอน";
    if (method === "cash") return "สด";
    return method || "—";
  }

  return (
    <div className={compact ? "pos-sales-report pos-sales-report--compact" : "pos-sales-report"}>
      <PosSessionsSlimTable
        sessions={sessions}
        sales={sales}
        selectedSessionId={selectedSessionId}
        dayLabel="ล่าสุด"
        onSelect={(id) => {
          setSelectedSessionId(id);
          if (id) {
            setBillsOpen(true);
            requestAnimationFrame(() => {
              document.getElementById("pos-sales-bills")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            });
          }
        }}
        onForceClose={(sessionId) => setForceCloseTargetId(sessionId)}
        forceCloseBusyId={forceCloseBusyId}
        onError={onError}
      />

      {dataIssues.length ? (
        <div className="pos-sales-reconcile-warn-note" role="status">
          <p className="muted">
            พบข้อมูลผิดปกติ {dataIssues.length} รอบในหน้าต่างนี้ — ตรวจแถวรอบ + รายบิล
          </p>
          <ul className="pos-sales-data-issue-list">
            {dataIssues.slice(0, 8).map((row) => (
              <li key={row.sessionId}>
                <button
                  type="button"
                  className="npos-slim-text-btn"
                  onClick={() => {
                    setSelectedSessionId(row.sessionId);
                    setBillsOpen(true);
                  }}
                >
                  {row.label}
                </button>
                <span className="muted"> · {row.issues.join(" · ")}</span>
              </li>
            ))}
            {dataIssues.length > 8 ? (
              <li className="muted">…และอีก {dataIssues.length - 8} รอบ</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <details
        id="pos-sales-bills"
        className="pos-sales-report-section pos-sales-bills-section pos-sales-bills-fold"
        open={billsOpen}
        onToggle={(e) => setBillsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="pos-sales-bills-summary">
          <span>
            รายการบิลล่าสุด
            {selectedSessionId ? ` · รอบ ${posSessionCode(selectedSessionId)}` : ""}
          </span>
          <span className="muted pos-sales-bills-count">
            {filteredSales.length
              ? `${Math.min(billsVisible, filteredSales.length)}/${filteredSales.length} · ใหม่→เก่า`
              : "หุบไว้"}
            {" · "}฿{formatPlainNumber(summary.total)} · {summary.activeCount} บิล
            {summary.voidedCount ? ` · ทำลาย ${summary.voidedCount}` : ""}
          </span>
        </summary>

        <div className="pos-sales-bill-toolbar">
          {selectedSessionId ? (
            <button
              type="button"
              className="npos-slim-text-btn"
              onClick={() => setSelectedSessionId(null)}
            >
              แสดงทุกบิล
            </button>
          ) : null}
          <div className="pos-sales-bill-chips pos-sales-bill-chips--text" role="group" aria-label="กรองสถานะ">
            {(
              [
                ["all", "ทั้งหมด"],
                ["ok", "ปกติ"],
                ["voided", "ทำลาย"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={statusFilter === id ? "is-active" : ""}
                onClick={() => setStatusFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="pos-sales-bill-chips pos-sales-bill-chips--text" role="group" aria-label="กรองชำระ">
            {(
              [
                ["all", "ทุกชำระ"],
                ["cash", "สด"],
                ["transfer", "โอน"],
                ["promptpay", "PP"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={payFilter === id ? "is-active" : ""}
                onClick={() => setPayFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="pos-sales-bill-search">
            <span className="muted">ค้นหาเลขบิล · ชื่อ · เบอร์</span>
            <input
              type="search"
              value={billQuery}
              onChange={(e) => setBillQuery(e.target.value)}
              placeholder="เช่น P2707-001"
            />
          </label>
        </div>
        {loading ? <p className="empty">กำลังโหลด...</p> : null}
        {!loading && filteredSales.length === 0 ? (
          <p className="muted">ยังไม่มีบิล — ขายที่แท็บเล็ต POS</p>
        ) : null}
        {!loading && filteredSales.length > 0 ? (
          <div className="pos-sales-bill-split pos-sales-bill-split--slim">
            <div className="npos-bills-slim-scroll" onScroll={onBillsScroll}>
              <div
                className="npos-slim-scroll npos-bills-slim-table"
                role="table"
                aria-label="รายการบิลล่าสุด"
              >
                <div className="npos-slim-row npos-slim-row--head npos-slim-row--bills-super" role="row">
                  <span role="columnheader">บิล</span>
                  <span role="columnheader">เวลา</span>
                  <span role="columnheader">ชำระ</span>
                  <span role="columnheader" className="npos-slim-col-session">
                    รอบ
                  </span>
                  <span role="columnheader" className="npos-slim-num">
                    รายการ
                  </span>
                  <span role="columnheader" className="npos-slim-num">
                    ยอด
                  </span>
                  <span role="columnheader"> </span>
                </div>
                {visibleSales.map((sale) => {
                  const voided = sale.status === "voided";
                  const busy = busyId === sale.id;
                  const active = selectedSale?.id === sale.id;
                  const canVoid = !voided && saleIsToday(sale, todayMs);
                  return (
                    <div
                      key={sale.id}
                      role="row"
                      className={`npos-slim-row npos-slim-row--bills-super ${voided ? "is-void" : ""} ${active ? "is-selected" : ""}`}
                      onClick={() => setSelectedSaleId(sale.id)}
                    >
                      <span role="cell" className="npos-slim-strong">
                        #{(sale.billNo || "—").replace(/^#/, "")}
                        {voided ? <span className="muted"> · ยกเลิก</span> : null}
                      </span>
                      <span role="cell" className="muted">
                        {formatTime(sale.createdAt)}
                      </span>
                      <span role="cell">{payLabel(sale.paymentMethod)}</span>
                      <span role="cell" className="npos-slim-code npos-slim-col-session">
                        {shortPosSessionId(sale.sessionId)}
                      </span>
                      <span role="cell" className="npos-slim-num">
                        {sale.lines?.length || "—"}
                      </span>
                      <span role="cell" className="npos-slim-num npos-slim-strong">
                        {formatPlainNumber(sale.total)}
                      </span>
                      <span role="cell" className="npos-slim-close-cell">
                        {canVoid ? (
                          <button
                            type="button"
                            className="npos-slim-text-btn pos-sales-void-btn"
                            disabled={busy}
                            title="ยกเลิกบิล"
                            onClick={(e) => {
                              e.stopPropagation();
                              openVoidDialog(sale);
                            }}
                          >
                            <Ban size={12} aria-hidden />
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {billsVisible < filteredSales.length ? (
                <p className="muted npos-bills-slim-more">เลื่อนลงเพื่อโหลดเพิ่ม…</p>
              ) : null}
            </div>
            <aside className="pos-sales-bill-detail" aria-label="รายละเอียดบิล">
              {selectedSale ? (
                <PosReceiptPaper
                  compact
                  receipt={saleToLocalReceipt(selectedSale)}
                  onVoid={
                    saleIsToday(selectedSale, todayMs) && selectedSale.status !== "voided"
                      ? () => openVoidDialog(selectedSale)
                      : undefined
                  }
                  voidBusy={busyId === selectedSale.id}
                />
              ) : (
                <p className="muted">เลือกบิลจากรายการ</p>
              )}
              <p className="muted pos-sales-bill-detail-note">
                สลิปแบบพิมพ์ · หลังบ้านดูอย่างเดียว — พิมพ์ซ้ำที่แท็บเล็ต
              </p>
            </aside>
          </div>
        ) : null}
      </details>

      <details className="pos-sales-fold pos-sales-fold--slim">
        <summary>
          ช่องทาง · เมนูขายดี
          <span className="muted">
            {" "}
            · ฿{formatPlainNumber(summary.total)} · {summary.activeCount} บิล
            {summary.voidedCount ? ` · ทำลาย ${summary.voidedCount}` : ""}
          </span>
        </summary>

        <div className="npos-slim-scroll" role="table" aria-label="สรุปช่องทางชำระ">
          <div className="npos-slim-row npos-slim-row--head npos-slim-row--compact" role="row">
            <span role="columnheader">ช่องทาง</span>
            <span role="columnheader" className="npos-slim-num">
              บิล
            </span>
            <span role="columnheader" className="npos-slim-num">
              ยอด
            </span>
          </div>
          {(
            [
              ["สุทธิ", summary.activeCount, summary.total],
              ["สด", summary.cashCount, summary.cashTotal],
              ["โอน", summary.transferCount, summary.transferTotal],
              ["PP", summary.promptpayCount, summary.promptpayTotal],
              ["ทำลาย", summary.voidedCount, summary.voidedTotal],
            ] as const
          ).map(([label, count, total]) => (
            <div key={label} className="npos-slim-row npos-slim-row--compact" role="row">
              <span role="cell">{label}</span>
              <span role="cell" className="npos-slim-num">
                {count || "—"}
              </span>
              <span role="cell" className="npos-slim-num npos-slim-strong">
                {total ? formatPlainNumber(total) : "—"}
              </span>
            </div>
          ))}
          {summary.discountTotal > 0 ? (
            <div className="npos-slim-row npos-slim-row--compact" role="row">
              <span role="cell">ส่วนลด</span>
              <span role="cell" className="npos-slim-num">
                {summary.discountCount || "—"}
              </span>
              <span role="cell" className="npos-slim-num">
                -{formatPlainNumber(summary.discountTotal)}
              </span>
            </div>
          ) : null}
        </div>

        {summary.topItems.length > 0 ? (
          <section className="pos-sales-report-section">
            <h3>เมนูขายดี</h3>
            <div className="npos-slim-scroll" role="table" aria-label="เมนูขายดี">
              <div className="npos-slim-row npos-slim-row--head npos-slim-row--compact" role="row">
                <span role="columnheader">เมนู</span>
                <span role="columnheader" className="npos-slim-num">
                  จำนวน
                </span>
                <span role="columnheader" className="npos-slim-num">
                  ยอด
                </span>
              </div>
              {summary.topItems.slice(0, 12).map((item) => (
                <div
                  key={item.menuItemId || item.name}
                  className="npos-slim-row npos-slim-row--compact"
                  role="row"
                >
                  <span role="cell" className="npos-slim-ellipsis">
                    {item.name}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {item.qty}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {formatPlainNumber(item.total)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </details>

      <PosConfirmDialog
        open={forceCloseTargetId !== null}
        title={
          forceCloseTarget
            ? `ปิดรอบ ${posSessionCode(forceCloseTarget.id)} จากหลังร้าน?`
            : "ปิดรอบจากหลังร้าน?"
        }
        message={
          forceCloseTarget
            ? `ปิดบนเซิร์ฟเวอร์ทันที · แท็บเล็ตตาม heartbeat (~5วิ) โดยไม่เสีย seat\nถ้ามีบิลในตะกร้า จะจบได้ก่อนแล้วค่อยออกจากขาย\nกะ: ${forceCloseTarget.shift || "—"}\nวันที่: ${
                forceCloseTarget.date
                  ? new Date(forceCloseTarget.date).toLocaleDateString("th-TH", {
                      day: "numeric",
                      month: "short",
                    })
                  : "—"
              }`
            : "กำลังโหลดรอบ…"
        }
        confirmLabel="ปิดรอบ"
        destructive
        busy={!!forceCloseBusyId}
        onCancel={() => {
          if (forceCloseBusyId) return;
          setForceCloseTargetId(null);
        }}
        onConfirm={() => void confirmForceClose()}
      />

      <PosConfirmDialog
        open={voidTarget !== null}
        title={
          voidTarget
            ? `ยกเลิกบิล #${(voidTarget.billNo || "—").replace(/^#/, "")}?`
            : ""
        }
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
  const [error, setError] = useState<string | null>(null);

  function setTab(next: PosSalesHubTab) {
    setError(null);
    router.replace(next === "manage" ? "/pos-sales/?tab=manage" : "/pos-sales/", { scroll: false });
  }

  return (
    <div className="module-page pos-sales-report-page pos-sales-report-page--dense pos-sales-report-page--slim">
      <header className="npos-bo-page-head">
        <div>
          <h1 className="panel-title pos-sales-page-title">POS</h1>
          <p className="muted pos-sales-page-lead">
            รอบ + บิล · โฟกัสเครื่อง 570F0F · ไม่ใช่กะ OT
          </p>
        </div>
        <nav className="npos-bo-page-tabs" role="tablist" aria-label="หมวด POS">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "report"}
            className={tab === "report" ? "npos-slim-text-btn is-active" : "npos-slim-text-btn"}
            onClick={() => setTab("report")}
          >
            รายงานยอดขาย
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "manage"}
            className={tab === "manage" ? "npos-slim-text-btn is-active" : "npos-slim-text-btn"}
            onClick={() => setTab("manage")}
          >
            จัดการ
          </button>
        </nav>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      {tab === "manage" ? <PosManagePanel onError={setError} /> : <PosSalesReport onError={setError} />}
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
