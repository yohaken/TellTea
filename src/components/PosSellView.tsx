"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QrCode, ShoppingCart, X } from "lucide-react";
import {
  seedPosMenuIfEmpty,
  subscribeMenuCategories,
  subscribeMenuItems,
  toggleMenuItemSoldOut,
} from "@/lib/pos-menu";
import { completeCashSale, completePromptPaySale } from "@/lib/pos-sales";
import { promptPayQrDataUrl } from "@/lib/pos-promptpay";
import { printPosReceipt } from "@/lib/pos-receipt";
import { subscribePosShopSettings } from "@/lib/pos-settings";
import { playPosSaleChime } from "@/lib/pos-sound";
import { labelOtShift } from "@/lib/ot";
import type { MenuCategory, MenuItem, PosSaleLine, PosSession } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";

type CartLine = { item: MenuItem; qty: number };
type PayMode = "cash" | "promptpay" | null;

const HOLD_MS = 550;

export function PosSellView({
  deviceId,
  session,
  onBusyChange,
}: {
  deviceId: string;
  session: PosSession;
  onBusyChange?: (state: { cartCount: number; payOpen: boolean; saleBusy: boolean }) => void;
}) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [payMode, setPayMode] = useState<PayMode>(null);
  const [cashInput, setCashInput] = useState("");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shopName, setShopName] = useState("TellTea");
  const [promptPayId, setPromptPayId] = useState("");
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const holdTimerRef = useRef<number | null>(null);
  const holdItemRef = useRef<MenuItem | null>(null);

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
    const unsubItems = subscribeMenuItems((list) => setItems(list));
    const unsubSettings = subscribePosShopSettings((s) => {
      setShopName(s.shopName);
      setPromptPayId(s.promptPayId);
      setAutoPrintReceipt(s.autoPrintReceipt);
    });
    return () => {
      unsubCat();
      unsubItems();
      unsubSettings();
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
  const payOpen = payMode !== null;

  useEffect(() => {
    onBusyChange?.({ cartCount, payOpen, saleBusy: busy });
  }, [busy, cartCount, onBusyChange, payOpen]);

  const total = cartLines.reduce((sum, l) => sum + l.item.price * l.qty, 0);
  const cashNum = Number(cashInput) || 0;
  const change = cashNum >= total ? Math.round((cashNum - total) * 100) / 100 : 0;

  function clearHoldTimer() {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdItemRef.current = null;
  }

  function addToCart(item: MenuItem) {
    if (!item.active) return;
    setCart((prev) => {
      const cur = prev[item.id];
      return {
        ...prev,
        [item.id]: { item, qty: (cur?.qty || 0) + 1 },
      };
    });
    setSuccess(null);
  }

  async function handleSoldOutToggle(item: MenuItem) {
    const soldOut = item.active;
    const ok = window.confirm(
      soldOut ? `ปิดขาย "${item.name}" (ของหมด)?` : `เปิดขาย "${item.name}" อีกครั้ง?`,
    );
    if (!ok) return;
    setError(null);
    try {
      await toggleMenuItemSoldOut(item.id, soldOut);
      if (soldOut) {
        setCart((prev) => {
          if (!prev[item.id]) return prev;
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    } catch (err) {
      setError((err as Error).message || "อัปเดตเมนูไม่สำเร็จ");
    }
  }

  function onItemPointerDown(item: MenuItem) {
    clearHoldTimer();
    holdItemRef.current = item;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      void handleSoldOutToggle(item);
    }, HOLD_MS);
  }

  function onItemPointerUp() {
    const item = holdItemRef.current;
    if (holdTimerRef.current != null && item) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (item.active) addToCart(item);
    }
    holdItemRef.current = null;
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

  function incCart(itemId: string) {
    setCart((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      return { ...prev, [itemId]: { ...cur, qty: cur.qty + 1 } };
    });
  }

  function clearLine(itemId: string) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  function closePay() {
    setPayMode(null);
    setCashInput("");
    setQrUrl(null);
    setError(null);
  }

  function openCashPay() {
    if (!cartCount) return;
    setCashInput(String(Math.ceil(total)));
    setPayMode("cash");
    setQrUrl(null);
    setError(null);
  }

  async function openPromptPayPay() {
    if (!cartCount) return;
    if (!promptPayId.trim()) {
      setError("ยังไม่ได้ตั้งเลข PromptPay — เจ้าของตั้งที่ TellTea → ตั้งค่า");
      return;
    }
    setPayMode("promptpay");
    setCashInput("");
    setError(null);
    setQrUrl(null);
    try {
      const url = await promptPayQrDataUrl(promptPayId, total);
      setQrUrl(url);
    } catch (err) {
      setError((err as Error).message || "สร้าง QR ไม่สำเร็จ");
    }
  }

  function saleLines(): PosSaleLine[] {
    return cartLines.map((l) => ({
      menuItemId: l.item.id,
      name: l.item.name,
      price: l.item.price,
      qty: l.qty,
    }));
  }

  function afterSaleSuccess(
    result: { billNo: string; total: number; change?: number },
    paymentMethod: "cash" | "promptpay",
    lines: PosSaleLine[],
  ) {
    const now = Date.now();
    if (autoPrintReceipt) {
      printPosReceipt({
        shopName,
        billNo: result.billNo,
        lines,
        total: result.total,
        paymentMethod,
        cashReceived: paymentMethod === "cash" ? cashNum : 0,
        change: result.change ?? 0,
        createdAt: now,
      });
    }
    setCart({});
    closePay();
    playPosSaleChime();
    const changeText =
      paymentMethod === "cash" && result.change != null
        ? ` · ทอน ฿${formatPlainNumber(result.change)}`
        : "";
    setSuccess(`บิล ${result.billNo} · ฿${formatPlainNumber(result.total)}${changeText}`);
    window.setTimeout(() => setSuccess(null), 2500);
  }

  async function confirmCashPay() {
    const lines = saleLines();
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
      afterSaleSuccess(result, "cash", lines);
    } catch (err) {
      setError((err as Error).message || "ชำระเงินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPromptPayPay() {
    const lines = saleLines();
    setBusy(true);
    setError(null);
    try {
      const result = await completePromptPaySale({
        deviceId,
        sessionId: session.id,
        shift: session.shift,
        lines,
      });
      afterSaleSuccess(result, "promptpay", lines);
    } catch (err) {
      setError((err as Error).message || "บันทึกการขายไม่สำเร็จ");
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

      <p className="muted pos-sell-hint">กดค้างเมนูเพื่อปิดขาย (ของหมด)</p>

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
          const soldOut = !item.active;
          return (
            <button
              key={item.id}
              type="button"
              className={`pos-sell-item ${soldOut ? "pos-sell-item--soldout" : ""}`}
              onPointerDown={() => onItemPointerDown(item)}
              onPointerUp={onItemPointerUp}
              onPointerLeave={clearHoldTimer}
              onPointerCancel={clearHoldTimer}
            >
              <span className="pos-sell-item-name">{item.name}</span>
              {soldOut ? (
                <span className="pos-sell-item-soldout">ของหมด</span>
              ) : (
                <span className="pos-sell-item-price">฿{formatPlainNumber(item.price)}</span>
              )}
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
              <div className="pos-sell-cart-line-actions">
                <button type="button" className="ghost-btn" aria-label="ลด" onClick={() => decFromCart(l.item.id)}>
                  −
                </button>
                <button type="button" className="ghost-btn" aria-label="เพิ่ม" onClick={() => incCart(l.item.id)}>
                  +
                </button>
                <button type="button" className="ghost-btn" aria-label="ลบ" onClick={() => clearLine(l.item.id)}>
                  ×
                </button>
              </div>
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
        <div className="pos-sell-bar-actions">
          <button type="button" className="primary-btn pos-sell-pay-btn" disabled={!cartCount} onClick={openCashPay}>
            เงินสด
          </button>
          <button
            type="button"
            className="ghost-btn pos-sell-pay-btn pos-sell-pay-btn--qr"
            disabled={!cartCount}
            onClick={() => void openPromptPayPay()}
          >
            <QrCode size={16} aria-hidden />
            PromptPay
          </button>
        </div>
      </div>

      {payOpen ? (
        <div className="pos-pay-modal" role="dialog" aria-modal="true">
          <div className="pos-pay-sheet">
            <div className="pos-pay-head">
              <h2>{payMode === "promptpay" ? "สแกนจ่าย PromptPay" : "รับเงินสด"}</h2>
              <button type="button" className="ghost-btn" aria-label="ปิด" onClick={closePay}>
                <X size={18} />
              </button>
            </div>
            <p className="pos-pay-total">
              ยอดรวม <strong>฿{formatPlainNumber(total)}</strong>
            </p>

            {payMode === "cash" ? (
              <>
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
              </>
            ) : (
              <>
                {qrUrl ? (
                  <div className="pos-pay-qr">
                    <img src={qrUrl} alt={`PromptPay ฿${formatPlainNumber(total)}`} width={280} height={280} />
                    <p className="muted">ให้ลูกค้าสแกนจ่าย แล้วกดยืนยันเมื่อได้เงินแล้ว</p>
                  </div>
                ) : (
                  <p className="muted">กำลังสร้าง QR...</p>
                )}
              </>
            )}

            {error ? <p className="error-text">{error}</p> : null}
            <button
              type="button"
              className="primary-btn pos-sell-pay-btn"
              disabled={
                busy ||
                (payMode === "cash" && cashNum < total) ||
                (payMode === "promptpay" && !qrUrl)
              }
              onClick={() => void (payMode === "cash" ? confirmCashPay() : confirmPromptPayPay())}
            >
              {busy ? "กำลังบันทึก..." : "ยืนยันขาย"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
