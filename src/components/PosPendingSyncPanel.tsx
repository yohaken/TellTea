"use client";

import { useState } from "react";
import { Ban, RefreshCw, Send, X } from "lucide-react";
import { labelOtShift } from "@/lib/ot";
import type { PosSyncSnapshot } from "@/lib/pos-sync";
import { retryOutboxEntry, runPosSyncFlush, voidPendingOutboxEntry } from "@/lib/pos-sync";
import type { OtShiftId } from "@/lib/ot";
import { formatPlainNumber } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function formatAge(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "เมื่อสักครู่";
  if (mins < 60) return `${mins} นาที`;
  return `${Math.floor(mins / 60)} ชม.`;
}

export function PosPendingSyncPanel({
  open,
  snapshot,
  onClose,
}: {
  open: boolean;
  snapshot: PosSyncSnapshot;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  if (!open) return null;

  async function handleFlushAll() {
    setFlushing(true);
    setError(null);
    try {
      await runPosSyncFlush();
    } catch (err) {
      setError((err as Error).message || "ส่งไม่สำเร็จ");
    } finally {
      setFlushing(false);
    }
  }

  async function handleRetry(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await retryOutboxEntry(id);
    } catch (err) {
      setError((err as Error).message || "ส่งอีกครั้งไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function handleVoid(id: string, billNo: string) {
    const ok = window.confirm(`ยกเลิกบิลค้าง ${billNo}?\nบิลนี้ยังไม่ขึ้นเซิร์ฟเวอร์ — จะลบออกจากคิวในเครื่อง`);
    if (!ok) return;
    setBusyId(id);
    setError(null);
    try {
      await voidPendingOutboxEntry(id);
    } catch (err) {
      setError((err as Error).message || "ยกเลิกไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="pos-sync-panel-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pos-sync-panel"
        role="dialog"
        aria-labelledby="pos-sync-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pos-sync-panel-header">
          <div>
            <h2 id="pos-sync-panel-title">บิลรอส่ง</h2>
            <p className="muted">
              {snapshot.pendingCount} รอส่ง
              {snapshot.failedCount > 0 ? ` · ${snapshot.failedCount} ล้มเหลว` : ""}
              {snapshot.stuckCount > 0 ? ` · ${snapshot.stuckCount} ค้างนาน` : ""}
            </p>
          </div>
          <button type="button" className="ghost-btn" aria-label="ปิด" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>

        {error ? <p className="error-text pos-sync-panel-error">{error}</p> : null}

        {snapshot.bills.length === 0 ? (
          <p className="muted pos-sync-panel-empty">ไม่มีบิลค้าง — ส่งครบแล้ว</p>
        ) : (
          <ul className="pos-sync-bill-list">
            {snapshot.bills.map((bill) => {
              const busy = busyId === bill.id;
              const failed = bill.status === "failed";
              return (
                <li
                  key={bill.id}
                  className={`pos-sync-bill-row ${failed ? "pos-sync-bill-row--failed" : ""} ${bill.stuck ? "pos-sync-bill-row--stuck" : ""}`}
                >
                  <div className="pos-sync-bill-main">
                    <strong>{bill.billNo}</strong>
                    <span className="muted">
                      {formatTime(bill.createdAt)} · ค้าง {formatAge(bill.createdAt)} ·{" "}
                      {labelOtShift(bill.shift as OtShiftId)} ·{" "}
                      {bill.paymentMethod === "promptpay" ? "PromptPay" : "เงินสด"}
                    </span>
                    <span className="pos-sync-bill-items">{bill.linePreview}</span>
                    {bill.lastError ? (
                      <span className="pos-sync-bill-error">{bill.lastError}</span>
                    ) : null}
                    {bill.attempts > 0 ? (
                      <span className="muted">ลองส่งแล้ว {bill.attempts} ครั้ง</span>
                    ) : null}
                  </div>
                  <div className="pos-sync-bill-end">
                    <strong>฿{formatPlainNumber(bill.total)}</strong>
                    <div className="pos-sync-bill-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={busy || flushing || snapshot.syncing}
                        onClick={() => void handleRetry(bill.id)}
                      >
                        <RefreshCw size={14} aria-hidden />
                        ส่งอีกครั้ง
                      </button>
                      <button
                        type="button"
                        className="ghost-btn pos-sync-void-btn"
                        disabled={busy}
                        onClick={() => void handleVoid(bill.id, bill.billNo)}
                      >
                        <Ban size={14} aria-hidden />
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="pos-sync-panel-footer">
          <button
            type="button"
            className="primary-btn"
            disabled={flushing || snapshot.syncing || snapshot.pendingCount === 0}
            onClick={() => void handleFlushAll()}
          >
            <Send size={16} aria-hidden />
            {flushing || snapshot.syncing ? "กำลังส่ง..." : "ส่งทั้งหมด"}
          </button>
        </footer>
      </div>
    </div>
  );
}
