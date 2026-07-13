"use client";

import { useEffect, useMemo, useState } from "react";
import { listLocalReceiptsForDay } from "@/lib/pos-local-receipts";
import { formatPlainNumber, startOfLocalDay } from "@/lib/utils";

export function PosReceiptsView() {
  const dayStart = startOfLocalDay();
  const [rows, setRows] = useState(() => listLocalReceiptsForDay(dayStart));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "dine">("all");

  useEffect(() => {
    const refresh = () => setRows(listLocalReceiptsForDay(dayStart));
    refresh();
    const t = window.setInterval(refresh, 3000);
    return () => window.clearInterval(t);
  }, [dayStart]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId],
  );

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
          </p>
          <div className="pos-receipts-filters">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
              ทั้งหมด
            </button>
            <button type="button" className={filter === "dine" ? "is-active" : ""} onClick={() => setFilter("dine")}>
              ทานที่ร้าน
            </button>
          </div>
        </header>
        <ul className="pos-receipts-list">
          {rows.length ? (
            rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`pos-receipts-row ${selectedId === r.id ? "is-active" : ""}`}
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
            <li className="pos-module-empty muted">ยังไม่มีใบเสร็จวันนี้บนเครื่องนี้</li>
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
              {selected.pending ? " · รอส่งเซิร์ฟเวอร์" : ""}
            </p>
          </>
        ) : (
          <p className="muted pos-module-empty">เลือกใบเสร็จจากรายการ</p>
        )}
      </div>
    </div>
  );
}
