"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PauseCircle, Pencil, QrCode, Tag, UserRound, X } from "lucide-react";
import { getPosMenuSnapshot, retryPosMenuPreload, startPosMenuPreload, subscribePosMenuPreload } from "@/lib/pos-menu-preload";
import { toggleMenuItemSoldOut } from "@/lib/pos-menu";
import {
  buildCartKey,
  cartLineToSaleLine,
  itemNeedsOptions,
  optionGroupsForItem,
  type PosCartLine,
  type PosCartSelection,
} from "@/lib/pos-menu-cart";
import { completeCashSale, completePromptPaySale } from "@/lib/pos-sales";
import { promptPayQrDataUrl } from "@/lib/pos-promptpay";
import { printOnSaleComplete } from "@/lib/pos-printer/router";
import { subscribePosShopSettings } from "@/lib/pos-settings";
import { appendLocalReceipt, saleLinesToLocalReceiptLines } from "@/lib/pos-local-receipts";
import { playPosSaleChime } from "@/lib/pos-sound";
import { computeSessionPendingOverlay } from "@/lib/pos-sync-utils";
import type { PosOutboxBillView } from "@/lib/pos-sync-types";
import { labelOtShift } from "@/lib/ot";
import type { MenuCategory, MenuItem, MenuOptionGroup, PosSaleLine, PosSession } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";
import { PosOptionPickerModal } from "@/components/PosOptionPickerModal";

type PayMode = "cash" | "promptpay" | null;

const HOLD_MS = 550;

function cartModifierLines(selections: PosCartSelection[]): string[] {
  const tallies = new Map<string, number>();
  for (const sel of selections) {
    for (const choice of sel.choices) {
      tallies.set(choice.name, (tallies.get(choice.name) ?? 0) + 1);
    }
  }
  return [...tallies.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
}

function lineHasEditableOptions(line: PosCartLine, allGroups: MenuOptionGroup[]): boolean {
  return itemNeedsOptions(line.item, allGroups) || line.selections.length > 0;
}

export function PosSellView({
  deviceId,
  devicePairingCode,
  session,
  pendingBills = [],
  onBusyChange,
}: {
  deviceId: string;
  devicePairingCode?: string;
  session: PosSession;
  pendingBills?: PosOutboxBillView[];
  onBusyChange?: (state: { cartCount: number; payOpen: boolean; saleBusy: boolean }) => void;
}) {
  const initialMenu = getPosMenuSnapshot();
  const [categories, setCategories] = useState<MenuCategory[]>(initialMenu.categories);
  const [items, setItems] = useState<MenuItem[]>(initialMenu.items);
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroup[]>(initialMenu.optionGroups);
  const [menuLoading, setMenuLoading] = useState(!initialMenu.ready);
  const [menuSyncing, setMenuSyncing] = useState(initialMenu.syncing);
  const [menuError, setMenuError] = useState<string | null>(initialMenu.error);
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<Record<string, PosCartLine>>({});
  const [payMode, setPayMode] = useState<PayMode>(null);
  const [cashInput, setCashInput] = useState("");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shopName, setShopName] = useState("TELL TEA");
  const [shopNameTh, setShopNameTh] = useState("เทล ที");
  const [shopAddress, setShopAddress] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [promptPayId, setPromptPayId] = useState("");
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [confirmSoldOut, setConfirmSoldOut] = useState<MenuItem | null>(null);
  const [picker, setPicker] = useState<{
    item: MenuItem;
    editCartKey?: string;
    initialSelections?: PosCartSelection[];
    initialQty?: number;
  } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);

  useEffect(() => {
    startPosMenuPreload();
    const unsub = subscribePosMenuPreload((snap) => {
      setCategories(snap.categories);
      setItems(snap.items);
      setOptionGroups(snap.optionGroups);
      setMenuSyncing(snap.syncing);
      setMenuError(snap.error);
      setMenuLoading(!snap.ready);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsubSettings = subscribePosShopSettings((s) => {
      setShopName(s.shopName);
      setShopNameTh(s.shopNameTh);
      setShopAddress(s.shopAddress);
      setShopPhone(s.shopPhone);
      setPromptPayId(s.promptPayId);
      setAutoPrintReceipt(s.autoPrintReceipt);
    });
    return unsubSettings;
  }, []);

  const activeCategories = useMemo(
    () =>
      categories.filter(
        (c) =>
          c.active &&
          items.some((i) => i.categoryId === c.id && i.active && i.visibleOnPos !== false),
      ),
    [categories, items],
  );

  useEffect(() => {
    if (!categoryId && activeCategories.length) {
      setCategoryId(activeCategories[0]!.id);
    }
  }, [activeCategories, categoryId]);

  const visibleItems = useMemo(
    () =>
      items
        .filter((i) => i.categoryId === categoryId && i.active && i.visibleOnPos !== false)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th")),
    [items, categoryId],
  );
  const cartLines = Object.values(cart);
  const cartCount = cartLines.reduce((n, l) => n + l.qty, 0);
  const payOpen = payMode !== null;

  useEffect(() => {
    onBusyChange?.({ cartCount, payOpen, saleBusy: false });
  }, [cartCount, onBusyChange, payOpen]);

  const sessionDisplay = useMemo(() => {
    const overlay = computeSessionPendingOverlay(session.id, pendingBills);
    return {
      saleCount: session.saleCount + overlay.extraSaleCount,
      totalSales: Math.round((session.totalSales + overlay.extraTotalSales) * 100) / 100,
    };
  }, [pendingBills, session.id, session.saleCount, session.totalSales]);

  const total = cartLines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const cashNum = Number(cashInput) || 0;
  const change = cashNum >= total ? Math.round((cashNum - total) * 100) / 100 : 0;

  function cancelHoldTimer() {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function addToCartDirect(
    item: MenuItem,
    selections: PosCartSelection[],
    unitPrice: number,
    addQty = 1,
  ) {
    const cartKey = buildCartKey(item.id, selections);
    setCart((prev) => {
      const cur = prev[cartKey];
      return {
        ...prev,
        [cartKey]: {
          cartKey,
          item,
          qty: (cur?.qty || 0) + addQty,
          unitPrice,
          selections,
        },
      };
    });
    setSuccess(null);
  }

  function tryAddItem(item: MenuItem) {
    if (!item.active) return;
    if (itemNeedsOptions(item, optionGroups)) {
      setPicker({ item });
      return;
    }
    addToCartDirect(item, [], item.price);
  }

  function openEditCartLine(line: PosCartLine) {
    setPicker({
      item: line.item,
      editCartKey: line.cartKey,
      initialSelections: line.selections,
      initialQty: line.qty,
    });
  }

  function confirmPicker(selections: PosCartSelection[], unitPrice: number, qty: number) {
    if (!picker) return;
    const { item, editCartKey } = picker;
    const cartKey = buildCartKey(item.id, selections);
    setCart((prev) => {
      const next = { ...prev };
      if (editCartKey) {
        delete next[editCartKey];
        next[cartKey] = { cartKey, item, qty, unitPrice, selections };
      } else {
        const cur = next[cartKey];
        next[cartKey] = {
          cartKey,
          item,
          qty: (cur?.qty || 0) + qty,
          unitPrice,
          selections,
        };
      }
      return next;
    });
    setPicker(null);
    setSuccess(null);
  }

  function requestSoldOutToggle(item: MenuItem) {
    setConfirmSoldOut(item);
    setError(null);
  }

  async function confirmSoldOutToggle() {
    const item = confirmSoldOut;
    if (!item) return;
    const soldOut = item.active;
    setConfirmSoldOut(null);
    setError(null);
    try {
      await toggleMenuItemSoldOut(item.id, soldOut);
      if (soldOut) {
        setCart((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key]?.item.id === item.id) delete next[key];
          }
          return next;
        });
      }
    } catch (err) {
      setError((err as Error).message || "อัปเดตเมนูไม่สำเร็จ");
    }
  }

  function onItemPointerDown(item: MenuItem) {
    longPressHandledRef.current = false;
    cancelHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      longPressHandledRef.current = true;
      requestSoldOutToggle(item);
    }, HOLD_MS);
  }

  function onItemClick(item: MenuItem) {
    if (longPressHandledRef.current) return;
    if (!item.active) return;
    tryAddItem(item);
  }

  function decFromCart(cartKey: string) {
    setCart((prev) => {
      const cur = prev[cartKey];
      if (!cur) return prev;
      if (cur.qty <= 1) {
        const next = { ...prev };
        delete next[cartKey];
        return next;
      }
      return { ...prev, [cartKey]: { ...cur, qty: cur.qty - 1 } };
    });
  }

  function incCart(cartKey: string) {
    setCart((prev) => {
      const cur = prev[cartKey];
      if (!cur) return prev;
      return { ...prev, [cartKey]: { ...cur, qty: cur.qty + 1 } };
    });
  }

  function clearLine(cartKey: string) {
    setCart((prev) => {
      const next = { ...prev };
      delete next[cartKey];
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
    setCashInput(String(total));
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
    return cartLines.map(cartLineToSaleLine);
  }

  function afterSaleSuccess(
    result: { billNo: string; total: number; change?: number; pending?: boolean; clientMutationId?: string },
    paymentMethod: "cash" | "promptpay",
    lines: PosSaleLine[],
  ) {
    const now = Date.now();
    const linePreview = lines.map((l) => `${l.name}×${l.qty}`).join(", ");
    appendLocalReceipt({
      id: result.clientMutationId || result.billNo,
      billNo: result.billNo,
      sessionId: session.id,
      total: result.total,
      paymentMethod,
      linePreview,
      lines: saleLinesToLocalReceiptLines(lines),
      cashReceived: paymentMethod === "cash" ? cashNum : undefined,
      change: paymentMethod === "cash" ? (result.change ?? 0) : undefined,
      createdAt: now,
      pending: result.pending === true,
    });
    void printOnSaleComplete(
      {
        kind: "receipt",
        shopName,
        shopNameTh,
        shopAddress,
        shopPhone,
        billNo: result.billNo,
        lines,
        total: result.total,
        paymentMethod,
        cashReceived: paymentMethod === "cash" ? cashNum : 0,
        change: result.change ?? 0,
        createdAt: now,
        orderChannel: "dine_in",
        staffName: "TellTea POS",
        staffId: devicePairingCode || deviceId.slice(-6).toUpperCase(),
      },
      { deviceId, printReceipt: autoPrintReceipt },
    );
    setCart({});
    closePay();
    playPosSaleChime();
    const changeText =
      paymentMethod === "cash" && result.change != null
        ? ` · ทอน ฿${formatPlainNumber(result.change)}`
        : "";
    setSuccess(
      `บันทึกแล้ว · บิล ${result.billNo} · ฿${formatPlainNumber(result.total)}${changeText}`,
    );
    window.setTimeout(() => setSuccess(null), 2500);
  }

  function confirmCashPay() {
    const lines = saleLines();
    setError(null);
    try {
      const result = completeCashSale({
        deviceId,
        sessionId: session.id,
        shift: session.shift,
        lines,
        cashReceived: cashNum,
      });
      afterSaleSuccess(result, "cash", lines);
    } catch (err) {
      setError((err as Error).message || "ชำระเงินไม่สำเร็จ");
    }
  }

  function confirmPromptPayPay() {
    const lines = saleLines();
    setError(null);
    try {
      const result = completePromptPaySale({
        deviceId,
        sessionId: session.id,
        shift: session.shift,
        lines,
      });
      afterSaleSuccess(result, "promptpay", lines);
    } catch (err) {
      setError((err as Error).message || "บันทึกการขายไม่สำเร็จ");
    }
  }

  if (menuLoading) {
    return (
      <div className="pos-sell-empty">
        <p>กำลังโหลดเมนู...</p>
        <p className="muted">ถ้าค้างนาน ตรวจ Wi‑Fi แล้วลองใหม่</p>
        <button type="button" className="ghost-btn" onClick={() => retryPosMenuPreload()}>
          ลองโหลดใหม่
        </button>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="pos-sell-empty">
        <p className="error-text">โหลดเมนูไม่สำเร็จ</p>
        <p className="muted">{menuError}</p>
        <button type="button" className="ghost-btn" onClick={() => retryPosMenuPreload()}>
          ลองใหม่
        </button>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="pos-sell-empty">
        <p>ยังไม่มีเมนูขาย</p>
        <p className="muted">เจ้าของตั้งเมนูที่ <a href="/pos/menu/">เมนู POS</a></p>
      </div>
    );
  }

  return (
    <div className="pos-sell-layout">
      <section className="pos-sell-main">
        <div className="pos-sell-statusbar">
          <span className="pos-sell-status-shift">{labelOtShift(session.shift as "late" | "morning" | "evening")}</span>
          <span className="pos-sell-status-meta">
            ขายแล้ว {sessionDisplay.saleCount} บิล · ฿{formatPlainNumber(sessionDisplay.totalSales)}
            {menuSyncing ? " · อัปเดตเมนู..." : ""}
          </span>
          <span className="pos-sell-status-hint">กดค้างเมนู = ปิดขายชั่วคราว</span>
          {success ? <span className="ok-text pos-sell-flash">{success}</span> : null}
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
            const qty = cartLines
              .filter((l) => l.item.id === item.id)
              .reduce((n, l) => n + l.qty, 0);
            const soldOut = !item.active;
            return (
              <button
                key={item.id}
                type="button"
                className={`pos-sell-item ${soldOut ? "pos-sell-item--soldout" : ""} ${item.recommended ? "pos-sell-item--rec" : ""}`}
                onPointerDown={() => onItemPointerDown(item)}
                onPointerUp={cancelHoldTimer}
                onPointerLeave={cancelHoldTimer}
                onPointerCancel={cancelHoldTimer}
                onClick={() => onItemClick(item)}
              >
                <div className="pos-sell-item-media">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" className="pos-sell-item-img" />
                  ) : (
                    <span className="pos-sell-item-placeholder" aria-hidden>
                      ☕
                    </span>
                  )}
                </div>
                <span className="pos-sell-item-name">
                  {item.recommended ? "★ " : ""}
                  {item.name}
                </span>
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
      </section>

      <aside className="pos-sell-cart-panel">
        <header className="pos-cart-head">
          <p className="pos-cart-channel">ทานที่ร้าน</p>
          <span className="pos-cart-bill-id">#{session.id.slice(-5).toUpperCase()}</span>
        </header>

        <button type="button" className="pos-cart-member-bar" disabled title="เร็วๆ นี้">
          <UserRound size={18} aria-hidden />
          <span>เพิ่มบัตรสะสมคะแนน</span>
        </button>

        <div className="pos-cart-lines">
          {cartLines.length ? (
            cartLines.map((l) => {
              const mods = cartModifierLines(l.selections);
              const lineTotal = l.unitPrice * l.qty;
              return (
                <div key={l.cartKey} className="pos-sell-cart-line">
                  <div className="pos-cart-line-body">
                    <div className="pos-cart-line-title">
                      <strong className="pos-cart-line-name">{l.item.name}</strong>
                      <span className="pos-cart-line-qty">×{l.qty}</span>
                    </div>
                    {mods.map((mod) => (
                      <p key={`${l.cartKey}-${mod}`} className="pos-cart-line-mod">
                        • {mod}
                      </p>
                    ))}
                    <div className="pos-sell-cart-line-actions">
                      {lineHasEditableOptions(l, optionGroups) ? (
                        <button
                          type="button"
                          className="pos-cart-touch-btn pos-cart-edit-btn"
                          aria-label="แก้ไขตัวเลือก"
                          onClick={() => openEditCartLine(l)}
                        >
                          <Pencil size={18} strokeWidth={2.5} aria-hidden />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="pos-cart-touch-btn"
                        aria-label="ลด"
                        onClick={() => decFromCart(l.cartKey)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="pos-cart-touch-btn"
                        aria-label="เพิ่ม"
                        onClick={() => incCart(l.cartKey)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="pos-cart-touch-btn pos-cart-touch-btn--danger"
                        aria-label="ลบ"
                        onClick={() => clearLine(l.cartKey)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="pos-cart-line-side">
                    <span className="pos-cart-line-price">฿{formatPlainNumber(lineTotal)}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="muted pos-cart-empty">แตะเมนูเพื่อเพิ่มรายการ</p>
          )}
        </div>

        <footer className="pos-cart-foot">
          <div className="pos-cart-totals">
            <div className="pos-cart-total-row">
              <span className="pos-cart-total-label">{cartCount} รายการ</span>
              <strong className="pos-cart-total-amount">฿{formatPlainNumber(total)}</strong>
            </div>
          </div>
          <div className="pos-cart-actions-secondary">
            <button type="button" className="pos-cart-secondary-btn" disabled title="เร็วๆ นี้">
              <PauseCircle size={18} aria-hidden />
              ส่งค้างไว้
            </button>
            <button type="button" className="pos-cart-secondary-btn" disabled title="เร็วๆ นี้">
              <Tag size={18} aria-hidden />
              โปรโมชั่น
            </button>
          </div>
          <button
            type="button"
            className="pos-btn-orange pos-cart-pay-hero"
            disabled={!cartCount}
            onClick={openCashPay}
          >
            ชำระเงิน {formatPlainNumber(total)} บาท
          </button>
          <div className="pos-cart-pay-alt">
            <button
              type="button"
              className="pos-cart-alt-btn pos-sell-pay-btn--qr"
              disabled={!cartCount}
              onClick={() => void openPromptPayPay()}
            >
              <QrCode size={18} aria-hidden />
              PromptPay
            </button>
            <button type="button" className="pos-cart-alt-btn" disabled={!cartCount} onClick={openCashPay}>
              เงินสด
            </button>
          </div>
        </footer>
      </aside>

      {confirmSoldOut ? (
        <div className="pos-confirm-modal" role="dialog" aria-modal="true">
          <div className="pos-confirm-card">
            <h3>{confirmSoldOut.active ? "ปิดขายเมนูนี้?" : "เปิดขายอีกครั้ง?"}</h3>
            <p>
              {confirmSoldOut.active
                ? `"${confirmSoldOut.name}" จะแสดงเป็นของหมด`
                : `"${confirmSoldOut.name}" จะกลับมาขายได้`}
            </p>
            <div className="pos-confirm-actions">
              <button type="button" className="ghost-btn" onClick={() => setConfirmSoldOut(null)}>
                ยกเลิก
              </button>
              <button type="button" className="primary-btn" onClick={() => void confirmSoldOutToggle()}>
                ยืนยัน
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {picker ? (
        <PosOptionPickerModal
          itemName={picker.item.name}
          basePrice={picker.item.price}
          groups={optionGroupsForItem(picker.item, optionGroups)}
          initialSelections={picker.initialSelections}
          initialQty={picker.initialQty}
          onCancel={() => setPicker(null)}
          onConfirm={confirmPicker}
        />
      ) : null}

      {payOpen ? (
        <div className="pos-pay-modal" role="dialog" aria-modal="true">
          <div className="pos-pay-sheet">
            <div className="pos-pay-head">
              <h2>{payMode === "promptpay" ? "สแกนจ่าย PromptPay" : "รับเงินสด"}</h2>
              <button type="button" className="ghost-btn" aria-label="ปิด" onClick={closePay}>
                <X size={18} />
              </button>
            </div>
            <p className="pos-pay-summary">
              {cartCount} รายการ · {payMode === "promptpay" ? "สแกนจ่าย" : "ชำระเงินสด"}
            </p>
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
                <div className="pos-pay-quick" role="group" aria-label="จำนวนเงินด่วน">
                  <button
                    type="button"
                    className="pos-pay-quick-btn pos-pay-quick-btn--exact"
                    onClick={() => setCashInput(String(Math.ceil(total)))}
                  >
                    ตรงพอดี
                    <span>฿{formatPlainNumber(total)}</span>
                  </button>
                  {[100, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className="pos-pay-quick-btn"
                      onClick={() => setCashInput(String(amt))}
                    >
                      ฿{amt}
                    </button>
                  ))}
                </div>
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
            <div className="pos-pay-actions">
              <button type="button" className="pos-pay-cancel-btn" onClick={closePay}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="pos-btn-orange pos-pay-confirm-btn"
                disabled={
                  (payMode === "cash" && cashNum < total) ||
                  (payMode === "promptpay" && !qrUrl)
                }
                onClick={() => (payMode === "cash" ? confirmCashPay() : confirmPromptPayPay())}
              >
                ยืนยันขาย
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
