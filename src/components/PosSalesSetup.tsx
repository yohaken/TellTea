"use client";

import { useEffect, useState } from "react";
import { Receipt, Ban } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { labelOtShift } from "@/lib/ot";
import {
  subscribePosSalesToday,
  summarizePosSales,
  voidPosSale,
} from "@/lib/pos-sales-admin";
import type { PosSale } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PosSalesSetup({ onError }: { onError: (msg: string | null) => void }) {
  const { actorId } = useAuth();
  const [sales, setSales] = useState<PosSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribePosSalesToday(
      (list) => {
        setSales(list);
        setLoading(false);
      },
      (err) => {
        onError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [onError]);

  const summary = summarizePosSales(sales);

  async function handleVoid(sale: PosSale) {
    if (!actorId || sale.status === "voided") return;
    const ok = window.confirm(
      `ยกเลิกบิล ${sale.billNo} ฿${formatPlainNumber(sale.total)}?\nยอดขาย POS จะถูกหักออกจากรายงานวันนี้`,
    );
    if (!ok) return;
    setBusyId(sale.id);
    onError(null);
    try {
      await voidPosSale(sale.id, actorId);
    } catch (err) {
      onError((err as Error).message || "ยกเลิกบิลไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Receipt size={18} aria-hidden />
        ยอดขาย POS วันนี้
      </h2>
      <p className="muted settings-card-lead">
        {summary.activeCount} บิล · ฿{formatPlainNumber(summary.total)}
        {summary.voidedCount > 0 ? ` · ยกเลิกแล้ว ${summary.voidedCount}` : ""}
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading && sales.length === 0 ? (
        <p className="muted settings-card-lead">ยังไม่มีบิลวันนี้ — ขายที่แท็บเล็ต POS</p>
      ) : null}

      {!loading && sales.length > 0 ? (
        <ul className="pos-sales-list">
          {sales.map((sale) => {
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
                  </span>
                  <span className="pos-sales-row-items">{preview}</span>
                </div>
                <div className="pos-sales-row-end">
                  <strong className={voided ? "muted" : ""}>฿{formatPlainNumber(sale.total)}</strong>
                  {!voided ? (
                    <button
                      type="button"
                      className="ghost-btn pos-sales-void-btn"
                      disabled={busy}
                      onClick={() => void handleVoid(sale)}
                    >
                      <Ban size={14} aria-hidden />
                      ยกเลิก
                    </button>
                  ) : (
                    <span className="pos-sales-voided">ยกเลิกแล้ว</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
