"use client";

import { useEffect, useMemo, useState } from "react";
import { listLocalReceiptsForDay } from "@/lib/pos-local-receipts";
import { formatPlainNumber, startOfLocalDay } from "@/lib/utils";

type ReceiptFilter = "all" | "pending" | "synced";

export function PosReceiptsView() {
  const dayStart = startOfLocalDay();
  const [rows, setRows] = useState(() => listLocalReceiptsForDay(dayStart));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReceiptFilter>("all");

  useEffect(() => {
    const refresh = () => setRows(listLocalReceiptsForDay(dayStart));
    refresh();
    const t = window.setInterval(refresh, 3000);
    return () => window.clearInterval(t);
  }, [dayStart]);

  const filtered = useMemo(() => {
    if (filter === "pending") return rows.filter((r) => r.pending);
    if (filter === "synced") return rows.filter((r) => !r.pending);
    return rows;
  }, [rows, filter]);

  const selected = useMemo(
    () => filtered.find((r) => r.id === selectedId) || filtered[0] || null,
    [filtered, selectedId],
  );

  const pendingCount = rows.filter((r) => r.pending).length;

  return (
    <div className="pos-module pos-module--split">
      <div className="pos-receipts-list-pane">
        <header className="pos-receipts-head">
          <h2>ประวัติใบเสร็จ</h2>
          <p className="muted">
            {new Date(dayStart).toLocaleDateString("th-TH", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
            {pendingCount > 0 ? ` · รอส่ง ${pendingCount}` : ""}
          </p>
          <div className="pos-receipts-filters">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
              ทั้งหมด ({rows.length})
            </button>
            <button
              type="button"
              className={filter === "pending" ? "is-active" : ""}
              onClick={() => setFilter("pending")}
            >
              รอส่ง ({rows.filter((r) => r.pending).length})
            </button>
            <button
              type="button"
              className={filter === "synced" ? "is-active" : ""}
              onClick={() => setFilter("synced")}
            >
              ส่งแล้ว ({rows.filter((r) => !r.pending).length})
            </button>
          </div>
        </header>
        <ul className="pos-receipts-list">
          {filtered.length ? (
            filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`pos-receipts-row ${selected?.id === r.id ? "is-active" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="pos-receipts-row-id">#{r.billNo}</span>
                  <span className="pos-receipts-row-total">฿{formatPlainNumber(r.total)}</span>
                  <span className="muted pos-receipts-row-time">
                    {new Date(r.createdAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {r.pending ? " · รอส่ง" : ""}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="pos-module-empty muted">
              {filter === "all" ? "ยังไม่มีใบเสร็จวันนี้บนเครื่องนี้" : "ไม่มีรายการในตัวกรองนี้"}
            </li>
          )}
        </ul>
      </div>
      <div className="pos-receipts-detail-pane">
        {selected ? (
          <>
            <h3>#{selected.billNo}</h3>
            <p>
              <strong>฿{formatPlainNumber(selected.total)}</strong>
            </p>
            <p className="muted">{selected.paymentMethod === "cash" ? "เงินสด" : "PromptPay"}</p>
            <p>{selected.linePreview}</p>
            <p className="muted">
              {new Date(selected.createdAt).toLocaleString("th-TH")}
              {selected.pending ? " · รอส่งเซิร์ฟเวอร์" : " · ส่งแล้ว"}
            </p>
          </>
        ) : (
          <p className="muted pos-module-empty">เลือกใบเสร็จจากรายการ</p>
        )}
      </div>
    </div>
  );
}
