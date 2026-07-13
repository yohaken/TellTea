"use client";

import { useEffect, useMemo, useState } from "react";
import { listLocalReceiptsForDay, type PosLocalReceipt } from "@/lib/pos-local-receipts";
import { formatPlainNumber, startOfLocalDay } from "@/lib/utils";

type ReceiptFilter = "all" | "pending" | "synced";

function ReceiptDetail({ receipt }: { receipt: PosLocalReceipt }) {
  const lines = receipt.lines?.length
    ? receipt.lines
    : receipt.linePreview.split(",").map((part) => ({
        name: part.trim(),
        qty: 1,
        unitPrice: receipt.total,
        options: [],
      }));

  return (
    <div className="pos-receipt-detail">
      <header className="pos-receipt-detail-head">
        <div>
          <span className="pos-receipt-detail-bill">#{receipt.billNo}</span>
          <span
            className={`pos-receipt-detail-badge ${receipt.pending ? "is-pending" : "is-synced"}`}
          >
            {receipt.pending ? "รอส่ง" : "ส่งแล้ว"}
          </span>
        </div>
        <p className="pos-receipt-detail-total">฿{formatPlainNumber(receipt.total)}</p>
      </header>

      <dl className="pos-receipt-detail-meta">
        <div>
          <dt>เวลา</dt>
          <dd>
            {new Date(receipt.createdAt).toLocaleString("th-TH", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </dd>
        </div>
        <div>
          <dt>ชำระ</dt>
          <dd>{receipt.paymentMethod === "cash" ? "เงินสด" : "PromptPay"}</dd>
        </div>
        {receipt.paymentMethod === "cash" && receipt.cashReceived != null ? (
          <>
            <div>
              <dt>รับเงิน</dt>
              <dd>฿{formatPlainNumber(receipt.cashReceived)}</dd>
            </div>
            <div>
              <dt>ทอน</dt>
              <dd>฿{formatPlainNumber(receipt.change ?? 0)}</dd>
            </div>
          </>
        ) : null}
      </dl>

      <section className="pos-receipt-detail-lines">
        <h4>รายการ ({lines.length})</h4>
        <ul>
          {lines.map((line, idx) => (
            <li key={`${receipt.id}-${idx}`} className="pos-receipt-detail-line">
              <div className="pos-receipt-detail-line-head">
                <span className="pos-receipt-detail-line-qty">×{line.qty}</span>
                <span className="pos-receipt-detail-line-name">{line.name}</span>
                <span className="pos-receipt-detail-line-price">
                  ฿{formatPlainNumber(line.unitPrice * line.qty)}
                </span>
              </div>
              {line.options.length ? (
                <ul className="pos-receipt-detail-mods">
                  {line.options.map((opt, oi) => (
                    <li key={oi}>
                      {opt.groupName}: {opt.choiceNames.join(", ")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

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
    <div className="pos-module pos-module--split pos-receipts-module">
      <div className="pos-receipts-list-pane">
        <header className="pos-receipts-head">
          <h2>ประวัติใบเสร็จ</h2>
          <p className="muted">
            {new Date(dayStart).toLocaleDateString("th-TH", {
              weekday: "short",
              day: "2-digit",
              month: "short",
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
          <ReceiptDetail receipt={selected} />
        ) : (
          <p className="muted pos-module-empty">เลือกใบเสร็จจากรายการ</p>
        )}
      </div>
    </div>
  );
}
