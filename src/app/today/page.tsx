"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { listOrdersForDay } from "@/lib/orders";
import type { Order } from "@/lib/types";
import { formatBaht } from "@/lib/utils";

export default function TodayPage() {
  return (
    <AuthGate>
      <TodayView />
    </AuthGate>
  );
}

function TodayView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listOrdersForDay()
      .then(setOrders)
      .catch((err) => setError(err.message || "โหลดยอดวันนี้ไม่สำเร็จ"));
  }, []);

  const summary = useMemo(() => {
    const total = orders.reduce((sum, o) => sum + o.total, 0);
    const cash = orders
      .filter((o) => o.paymentMethod === "cash")
      .reduce((sum, o) => sum + o.total, 0);
    const transfer = orders
      .filter((o) => o.paymentMethod === "transfer")
      .reduce((sum, o) => sum + o.total, 0);
    return { total, cash, transfer, count: orders.length };
  }, [orders]);

  return (
    <div>
      <h1 className="panel-title">วันนี้</h1>
      {error ? <p className="error-text">{error}</p> : null}

      <div className="stats-grid">
        <div className="stat-tile">
          <p>ยอดรวม</p>
          <strong>{formatBaht(summary.total)}</strong>
        </div>
        <div className="stat-tile">
          <p>จำนวนออเดอร์</p>
          <strong>{summary.count}</strong>
        </div>
        <div className="stat-tile">
          <p>เงินสด</p>
          <strong>{formatBaht(summary.cash)}</strong>
        </div>
        <div className="stat-tile">
          <p>โอน</p>
          <strong>{formatBaht(summary.transfer)}</strong>
        </div>
      </div>

      <div className="list-card">
        {orders.length === 0 ? (
          <p className="empty">ยังไม่มีออเดอร์วันนี้</p>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="list-row">
              <div>
                <strong>{formatBaht(order.total)}</strong>
                <div className="muted">
                  {order.paymentMethod === "cash" ? "เงินสด" : "โอน"} ·{" "}
                  {new Date(order.createdAt).toLocaleTimeString("th-TH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {order.items.map((i) => `${i.name}×${i.qty}`).join(", ")}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
