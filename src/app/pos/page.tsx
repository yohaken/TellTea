"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { listMenuItems } from "@/lib/menu";
import { createOrder } from "@/lib/orders";
import type { CartLine, MenuItem, PaymentMethod } from "@/lib/types";
import { formatBaht } from "@/lib/utils";

export default function PosPage() {
  return (
    <AuthGate>
      <PosView />
    </AuthGate>
  );
}

function PosView() {
  const { user } = useAuth();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listMenuItems()
      .then(setMenu)
      .catch((err) => setError(err.message || "โหลดเมนูไม่สำเร็จ"));
  }, []);

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.qty, 0),
    [cart],
  );

  function addToCart(item: MenuItem) {
    setMessage(null);
    setCart((prev) => {
      const found = prev.find((line) => line.menuId === item.id);
      if (found) {
        return prev.map((line) =>
          line.menuId === item.id ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [...prev, { menuId: item.id, name: item.name, price: item.price, qty: 1 }];
    });
  }

  function changeQty(menuId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((line) => (line.menuId === menuId ? { ...line, qty: line.qty + delta } : line))
        .filter((line) => line.qty > 0),
    );
  }

  async function checkout() {
    if (!user?.email || cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await createOrder({
        items: cart.map((line) => ({
          menuId: line.menuId,
          name: line.name,
          price: line.price,
          qty: line.qty,
        })),
        paymentMethod,
        createdBy: user.email,
      });
      setCart([]);
      setMessage("บันทึกออเดอร์แล้ว");
    } catch (err) {
      setError((err as Error).message || "บันทึกออเดอร์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-layout">
      <section>
        <h1 className="panel-title">ขาย</h1>
        {error ? <p className="error-text">{error}</p> : null}
        {menu.length === 0 ? (
          <p className="empty">ยังไม่มีเมนู — ไปเพิ่มที่หน้าเมนูก่อน</p>
        ) : (
          <div className="menu-grid">
            {menu.map((item) => (
              <button
                key={item.id}
                type="button"
                className="menu-tile"
                disabled={!item.available}
                onClick={() => addToCart(item)}
              >
                <strong>{item.name}</strong>
                <span>{formatBaht(item.price)}</span>
                <small>{item.available ? item.category : "ปิดขาย"}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <aside className="cart-panel">
        <h2 className="panel-title">ตะกร้า</h2>
        {cart.length === 0 ? (
          <p className="empty">แตะเมนูเพื่อเพิ่มรายการ</p>
        ) : (
          cart.map((line) => (
            <div key={line.menuId} className="cart-line">
              <div>
                <strong>{line.name}</strong>
                <div className="muted">{formatBaht(line.price * line.qty)}</div>
              </div>
              <div className="qty-controls">
                <button type="button" onClick={() => changeQty(line.menuId, -1)}>
                  −
                </button>
                <span>{line.qty}</span>
                <button type="button" onClick={() => changeQty(line.menuId, 1)}>
                  +
                </button>
              </div>
            </div>
          ))
        )}

        <div className="pay-toggle">
          <button
            type="button"
            className={paymentMethod === "cash" ? "active" : ""}
            onClick={() => setPaymentMethod("cash")}
          >
            เงินสด
          </button>
          <button
            type="button"
            className={paymentMethod === "transfer" ? "active" : ""}
            onClick={() => setPaymentMethod("transfer")}
          >
            โอน
          </button>
        </div>

        <div className="list-row">
          <strong>รวม</strong>
          <strong>{formatBaht(total)}</strong>
        </div>

        {message ? <p className="muted">{message}</p> : null}

        <button
          type="button"
          className="primary-btn"
          style={{ width: "100%", marginTop: "0.75rem" }}
          disabled={busy || cart.length === 0}
          onClick={() => void checkout()}
        >
          {busy ? "กำลังบันทึก..." : "บันทึกออเดอร์"}
        </button>
      </aside>
    </div>
  );
}
