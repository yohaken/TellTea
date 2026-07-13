"use client";

import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, X } from "lucide-react";
import { seedPosMenuIfEmpty, subscribeMenuCategories, subscribeMenuItems } from "@/lib/pos-menu";
import { completeCashSale } from "@/lib/pos-sales";
import { labelOtShift } from "@/lib/ot";
import type { MenuCategory, MenuItem, PosSaleLine, PosSession } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

type CartLine = { item: MenuItem; qty: number };

export function PosSellView({
  deviceId,
  session,
}: {
  deviceId: string;
  session: PosSession;
}) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [payOpen, setPayOpen] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void seedPosMenuIfEmpty().catch((err) => {
      setMenuError((err as Error).message || "โหลดเมนูไม่สำเร็จ");
      setMenuLoading(false);
    });

    const unsubCat = subscribeMenuCategories(
      (list) => {
        setCategories(list);
        setMenuLoading(false);
        setMenuError(null);
      },
      (err) => {
        setMenuError(err.message);
        setMenuLoading(false);
      },
    );
    const unsubItems = subscribeMenuItems(
      (list) => setItems(list.filter((i) => i.active)),
      (err) => {
        setMenuError(err.message);
        setMenuLoading(false);
      },
    );
    return () => {
      unsubCat();
      unsubItems();
    };
  }, []);

  const activeCategories = useMemo(
    () => categories.filter((c) => c.active && items.some((i) => i.categoryId === c.id)),
    [categories, items],
  );

  useEffect(() => {
    if (!categoryId && activeCategories.length) {
      setCategoryId(activeCategories[0]!.id);
    }
  }, [activeCategories, categoryId]);

  const visibleItems = items.filter((i) => i.categoryId === categoryId);
  const cartLines = Object.values(cart);
  const cartCount = cartLines.reduce((n, l) => n + l.qty, 0);
  const total = cartLines.reduce((sum, l) => sum + l.item.price * l.qty, 0);
  const cashNum = Number(cashInput) || 0;
  const change = cashNum >= total ? Math.round((cashNum - total) * 100) / 100 : 0;

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const cur = prev[item.id];
      return {
        ...prev,
        [item.id]: { item, qty: (cur?.qty || 0) + 1 },
      };
    });
    setSuccess(null);
  }

  function decFromCart(itemId: string) {
    setCart((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      if (cur.qty <= 1) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: { ...cur, qty: cur.qty - 1 } };
    });
  }

  function openPay() {
    if (!cartCount) return;
    setCashInput(String(Math.ceil(total)));
    setPayOpen(true);
    setError(null);
  }

  async function confirmPay() {
    const lines: PosSaleLine[] = cartLines.map((l) => ({
      menuItemId: l.item.id,
      name: l.item.name,
      price: l.item.price,
      qty: l.qty,
    }));
    setBusy(true);
    setError(null);
    try {
      const result = await completeCashSale({
        deviceId,
        sessionId: session.id,
        shift: session.shift,
        lines,
        cashReceived: cashNum,
      });
      setCart({});
      setPayOpen(false);
      setCashInput("");
      setSuccess(`รับเงิน ฿${formatPlainNumber(result.total)} · ทอน ฿${formatPlainNumber(result.change)}`);
      window.setTimeout(() => setSuccess(null), 2500);
    } catch (err) {
      setError((err as Error).message || "ชำระเงินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (menuLoading) {
    return (
      <div className="pos-sell-empty">
        <p>กำลังโหลดเมนู...</p>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="pos-sell-empty">
        <p className="error-text">โหลดเมนูไม่สำเร็จ</p>
        <p className="muted">{menuError}</p>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="pos-sell-empty">
        <p>ยังไม่มีเมนูขาย</p>
        <p className="muted">เจ้าของตั้งเมนูที่ TellTea → ตั้งค่า → เมนู POS</p>
      </div>
    );
  }

  return (
    <div className="pos-sell">
      <div className="pos-sell-top">
        <div>
          <strong>{labelOtShift(session.shift as "late" | "morning" | "evening")}</strong>
          <span className="muted pos-sell-top-meta">
            ขายแล้ว {session.saleCount} บิล · ฿{formatPlainNumber(session.totalSales)}
          </span>
        </div>
        {success ? <p className="ok-text pos-sell-flash">{success}</p> : null}
      </div>

      <div className="pos-sell-cats" role="tablist">
        {activeCategories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            className={`pos-sell-cat ${categoryId === cat.id ? "is-active" : ""}`}
            onClick={() => setCategoryId(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <div className="pos-sell-grid">
        {visibleItems.map((item) => {
          const qty = cart[item.id]?.qty || 0;
          return (
            <button key={item.id} type="button" className="pos-sell-item" onClick={() => addToCart(item)}>
              <span className="pos-sell-item-name">{item.name}</span>
              <span className="pos-sell-item-price">฿{formatPlainNumber(item.price)}</span>
              {qty > 0 ? <span className="pos-sell-item-qty">×{qty}</span> : null}
            </button>
          );
        })}
      </div>

      {cartCount > 0 ? (
        <div className="pos-sell-cart-preview">
          {cartLines.map((l) => (
            <div key={l.item.id} className="pos-sell-cart-line">
              <span>
                {l.item.name} ×{l.qty}
              </span>
              <button type="button" className="ghost-btn" onClick={() => decFromCart(l.item.id)}>
                −
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pos-sell-bar">
        <div className="pos-sell-bar-total">
          <ShoppingCart size={18} aria-hidden />
          <span>
            {cartCount} รายการ · <strong>฿{formatPlainNumber(total)}</strong>
          </span>
        </div>
        <button type="button" className="primary-btn pos-sell-pay-btn" disabled={!cartCount} onClick={openPay}>
          รับเงินสด
        </button>
      </div>

      {payOpen ? (
        <div className="pos-pay-modal" role="dialog" aria-modal="true">
          <div className="pos-pay-sheet">
            <div className="pos-pay-head">
              <h2>รับเงินสด</h2>
              <button type="button" className="ghost-btn" aria-label="ปิด" onClick={() => setPayOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="pos-pay-total">
              ยอดรวม <strong>฿{formatPlainNumber(total)}</strong>
            </p>
            <label className="pos-pay-field">
              <span>รับเงินมา</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={cashInput}
                autoFocus
                onChange={(e) => setCashInput(e.target.value)}
              />
            </label>
            <p className={`pos-pay-change ${cashNum >= total ? "ok-text" : "error-text"}`}>
              ทอน {cashNum >= total ? `฿${formatPlainNumber(change)}` : "— เงินไม่พอ"}
            </p>
            {error ? <p className="error-text">{error}</p> : null}
            <button
              type="button"
              className="primary-btn pos-sell-pay-btn"
              disabled={busy || cashNum < total}
              onClick={() => void confirmPay()}
            >
              {busy ? "กำลังบันทึก..." : "ยืนยันขาย"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
