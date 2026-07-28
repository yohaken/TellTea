"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { voidPosSale } from "@/lib/pos-sales-admin";
import {
  posSessionCode,
  reconcilePosSessions,
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
  const reconcile = useMemo(() => reconcilePosSessions(sales, sessions), [sales, sessions]);
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
            requestAnimationFrame(() => {
              document.getElementById("pos-sales-bills")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            });
          }
        }}
        onError={onError}
      />

      {reconcile.some((r) => !r.countMatch || !r.totalMatch) ? (
        <p className="muted pos-sales-reconcile-warn-note">
          มีรอบที่ตัวเลข session กับบิลไม่ตรง — ดูแถวรอบ + รายบิลด้านล่าง
        </p>
      ) : null}

      <section
        id="pos-sales-bills"
        className="pos-sales-report-section pos-sales-bills-section"
      >
        <h3>
          รายการบิลล่าสุด
          {selectedSessionId
            ? ` · รอบ ${posSessionCode(selectedSessionId)}`
            : ""}
          <span className="muted pos-sales-bills-count">
            {" "}
            · สุทธิ ฿{formatPlainNumber(summary.total)} · {summary.activeCount} บิล
            {summary.voidedCount ? ` · ทำลาย ${summary.voidedCount}` : ""}
          </span>
        </h3>
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
          <div className="pos-sales-bill-split">
            <ul className="pos-sales-list">
              {filteredSales.map((sale) => {
                const voided = sale.status === "voided";
                const busy = busyId === sale.id;
                const active = selectedSale?.id === sale.id;
                const canVoid = !voided && saleIsToday(sale, todayMs);
                const preview = sale.lines
                  .slice(0, 2)
                  .map((l) => `${l.name}×${l.qty}`)
                  .join(", ");
                return (
                  <li
                    key={sale.id}
                    className={`pos-sales-row ${voided ? "pos-sales-row--void" : ""} ${active ? "is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="pos-sales-row-select"
                      onClick={() => setSelectedSaleId(sale.id)}
                    >
                      <div className="pos-sales-row-main">
                        <strong className="pos-sales-bill-id">
                          #{(sale.billNo || "—").replace(/^#/, "")}
                        </strong>
                        <span className="muted">
                          {formatTime(sale.createdAt)} · {shortPosSessionId(sale.sessionId)} ·{" "}
                          {sale.paymentMethod === "promptpay"
                            ? "PromptPay"
                            : sale.paymentMethod === "transfer"
                              ? "โอนเงิน"
                              : "เงินสด"}
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
                        <strong className={voided ? "muted" : ""}>
                          ฿{formatPlainNumber(sale.total)}
                        </strong>
                        {voided ? <span className="pos-sales-voided">ยกเลิกแล้ว</span> : null}
                      </div>
                    </button>
                    {canVoid ? (
                      <button
                        type="button"
                        className="npos-slim-text-btn pos-sales-void-btn"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          openVoidDialog(sale);
                        }}
                      >
                        <Ban size={12} aria-hidden />
                        ยกเลิก
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
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
      </section>

      <details className="pos-sales-fold pos-sales-fold--slim">
        <summary>
          สรุปยอด · รอบ nPos · เมนูขายดี
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

        {summary.bySession.length > 0 ? (
          <section className="pos-sales-report-section">
            <h3>แยกตามรอบ nPos</h3>
            <div className="npos-slim-scroll" role="table" aria-label="แยกตามรอบ">
              <div className="npos-slim-row npos-slim-row--head npos-slim-row--shift" role="row">
                <span role="columnheader">รอบ</span>
                <span role="columnheader" className="npos-slim-num">
                  บิล
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
                <span role="columnheader" className="npos-slim-num">
                  รวม
                </span>
              </div>
              {summary.bySession.map((row) => (
                <div key={row.sessionId} className="npos-slim-row npos-slim-row--shift" role="row">
                  <span role="cell" title={row.sessionId}>
                    {row.label}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.count || "—"}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.cashTotal ? formatPlainNumber(row.cashTotal) : "—"}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.transferTotal ? formatPlainNumber(row.transferTotal) : "—"}
                  </span>
                  <span role="cell" className="npos-slim-num">
                    {row.promptpayTotal ? formatPlainNumber(row.promptpayTotal) : "—"}
                  </span>
                  <span role="cell" className="npos-slim-num npos-slim-strong">
                    {row.total ? formatPlainNumber(row.total) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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
              {summary.topItems.map((item) => (
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
            ตาราง slim · ใหม่สุดบน · รหัสเครื่อง/รอบ · ปิดกะ realtime — ไม่ใช่กะ OT
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
