"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Tag, X } from "lucide-react";
import { getPosMenuSnapshot, publishLocalMenuOrder, retryPosMenuPreload, startPosMenuPreload, subscribePosMenuPreload } from "@/lib/pos-menu-preload";
import { reorderMenuCategories, toggleMenuItemSoldOut } from "@/lib/pos-menu";
import { applyActiveIdsOrder } from "@/lib/pos-drag-reorder";
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
import { getLocalPosShopSettings, subscribePosShopSettings } from "@/lib/pos-settings";
import {
  buildRankMaps,
  sortCategoriesByRank,
  sortItemsByRank,
  type MenuArrangeMode,
  type PosMenuRankTable,
} from "@/lib/pos-bestseller-rank";
import { getCachedPosMenuRank, subscribePosMenuRank } from "@/lib/pos-menu-rank-store";
import { appendLocalReceipt, saleLinesToLocalReceiptLines } from "@/lib/pos-local-receipts";
import { playPosSaleChime } from "@/lib/pos-sound";
import { computeSessionPendingOverlay } from "@/lib/pos-sync-utils";
import type { PosOutboxBillView } from "@/lib/pos-sync-types";
import { formatPosElapsedHm, formatPosOpenedAtShort } from "@/lib/pos-session";
import type { MenuCategory, MenuItem, MenuOptionGroup, PosSaleLine, PosSession } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";
import { PosOptionPickerModal } from "@/components/PosOptionPickerModal";
import { PosConfirmDialog } from "@/components/PosConfirmDialog";
import { PosPayOrderReview } from "@/components/PosPayOrderReview";
import { PosCashKeypad, parseCashAmount } from "@/components/PosCashKeypad";
import { PosLazyMenuImage } from "@/components/PosLazyMenuImage";
import { PosSellCategoryBar } from "@/components/PosSellCategoryBar";
import { PosDiscountModal } from "@/components/PosDiscountModal";
import {
  payableAfterDiscount,
  resolveDiscountBaht,
  type PosCartDiscount,
} from "@/lib/pos-discount";

function useSessionElapsedLabel(openedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [openedAt]);
  return {
    started: formatPosOpenedAtShort(openedAt),
    elapsed: formatPosElapsedHm(now - openedAt),
  };
}

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
  const initialShop = getLocalPosShopSettings();
  const [shopName, setShopName] = useState(initialShop.shopName);
  const [shopNameTh, setShopNameTh] = useState(initialShop.shopNameTh);
  const [shopAddress, setShopAddress] = useState(initialShop.shopAddress);
  const [shopPhone, setShopPhone] = useState(initialShop.shopPhone);
  const [promptPayId, setPromptPayId] = useState(initialShop.promptPayId);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(initialShop.autoPrintReceipt);
  const [receiptStaffName, setReceiptStaffName] = useState(initialShop.receiptStaffName);
  const [receiptFooterNote, setReceiptFooterNote] = useState(initialShop.receiptFooterNote);
  const [menuArrangeMode, setMenuArrangeMode] = useState<MenuArrangeMode>(initialShop.menuArrangeMode);
  const [menuRank, setMenuRank] = useState<PosMenuRankTable | null>(() => getCachedPosMenuRank());
  const [confirmSoldOut, setConfirmSoldOut] = useState<MenuItem | null>(null);
  const [cartDiscount, setCartDiscount] = useState<PosCartDiscount | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [confirmClearCart, setConfirmClearCart] = useState(false);
  const [picker, setPicker] = useState<{
    item: MenuItem;
    editCartKey?: string;
    initialSelections?: PosCartSelection[];
    initialQty?: number;
  } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);
  const sessionElapsed = useSessionElapsedLabel(session.openedAt);

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
      setReceiptStaffName(s.receiptStaffName);
      setReceiptFooterNote(s.receiptFooterNote);
      setMenuArrangeMode(s.menuArrangeMode);
    });
    return unsubSettings;
  }, []);

  useEffect(() => subscribePosMenuRank(setMenuRank), []);

  const rankMaps = useMemo(() => buildRankMaps(menuRank), [menuRank]);

  const activeCategories = useMemo(() => {
    const filtered = categories.filter(
      (c) =>
        c.active &&
        items.some((i) => i.categoryId === c.id && i.visibleOnPos !== false),
    );
    if (menuArrangeMode === "bestsellers") {
      return sortCategoriesByRank(filtered, rankMaps.categoryRank);
    }
    return [...filtered].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"),
    );
  }, [categories, items, menuArrangeMode, rankMaps.categoryRank]);

  useEffect(() => {
    if (!categoryId && activeCategories.length) {
      setCategoryId(activeCategories[0]!.id);
    }
  }, [activeCategories, categoryId]);

  const visibleItems = useMemo(() => {
    const filtered = items.filter((i) => i.categoryId === categoryId && i.visibleOnPos !== false);
    if (menuArrangeMode === "bestsellers") {
      return sortItemsByRank(filtered, rankMaps.itemRank);
    }
    return [...filtered].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th");
    });
  }, [items, categoryId, menuArrangeMode, rankMaps.itemRank]);
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

  const subtotal = cartLines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const discountBaht = resolveDiscountBaht(subtotal, cartDiscount);
  const total = payableAfterDiscount(subtotal, cartDiscount);
  const cashNum = parseCashAmount(cashInput);

  useEffect(() => {
    if (cartCount === 0 && cartDiscount) setCartDiscount(null);
  }, [cartCount, cartDiscount]);

  useEffect(() => {
    if (!cartDiscount) return;
    if (resolveDiscountBaht(subtotal, cartDiscount) <= 0) setCartDiscount(null);
  }, [subtotal, cartDiscount]);

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
    const markingSoldOut = item.active;
    setConfirmSoldOut(null);
    setError(null);
    const nextActive = !markingSoldOut;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, active: nextActive } : i)));
    try {
      await toggleMenuItemSoldOut(item.id, markingSoldOut);
      if (markingSoldOut) {
        setCart((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key]?.item.id === item.id) delete next[key];
          }
          return next;
        });
      }
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, active: item.active } : i)));
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

  function commitCategoryReorder(orderedActiveIds: string[]) {
    if (menuArrangeMode === "bestsellers") return;
    const nextCategories = applyActiveIdsOrder(categories, orderedActiveIds);
    const before = categories
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"))
      .map((c) => c.id)
      .join("|");
    const after = nextCategories
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"))
      .map((c) => c.id)
      .join("|");
    if (before === after) return;

    setCategories(nextCategories);
    publishLocalMenuOrder({
      categories: nextCategories,
      items,
      optionGroups,
    });
    const orderedIds = nextCategories
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c.id);
    void reorderMenuCategories(orderedIds).catch(() => {
      /* คงลำดับในเครื่อง — ซิงก์รอบถัดไป */
    });
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
    setCashInput("");
    setPayMode("cash");
    setQrUrl(null);
    setError(null);
  }

  async function openPromptPayPay() {
    if (!cartCount) return;
    if (!promptPayId.trim()) {
      setError("ยังไม่ได้ตั้งเลข PromptPay — ไปเมนู ตั้งค่ากิจการ → ชำระเงิน");
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
      discountBaht: discountBaht > 0 ? discountBaht : undefined,
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
        subtotal,
        discountBaht: discountBaht > 0 ? discountBaht : undefined,
        total: result.total,
        paymentMethod,
        cashReceived: paymentMethod === "cash" ? cashNum : 0,
        change: result.change ?? 0,
        createdAt: now,
        staffName: receiptStaffName,
        staffId: devicePairingCode || deviceId.slice(-6).toUpperCase(),
        receiptFooterNote,
      },
      { deviceId, printReceipt: autoPrintReceipt },
    );
    setCart({});
    setCartDiscount(null);
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
        discountBaht,
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
        discountBaht,
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

  if (!items.length) {
    return (
      <div className="pos-sell-empty">
        <p>{menuSyncing ? "กำลังดึงเมนู..." : "ยังไม่มีเมนูขาย"}</p>
        {menuError ? <p className="error-text">{menuError}</p> : null}
        <p className="muted">เจ้าของตั้งเมนูที่ <a href="/pos/menu/">เมนู POS</a></p>
        <button type="button" className="ghost-btn" onClick={() => retryPosMenuPreload()}>
          ลองโหลดใหม่
        </button>
      </div>
    );
  }

  return (
    <div className="pos-sell-layout">
      <section className="pos-sell-main">
        <div className="pos-sell-statusbar">
          <span className="pos-sell-status-shift" aria-live="polite">
            เริ่ม {sessionElapsed.started} · ทำแล้ว {sessionElapsed.elapsed}
          </span>
          <span className="pos-sell-status-meta">
            ขายแล้ว {sessionDisplay.saleCount} บิล · ฿{formatPlainNumber(sessionDisplay.totalSales)}
            {menuSyncing ? " · อัปเดตเมนู..." : ""}
          </span>
          <span className="pos-sell-status-hint">
            {menuArrangeMode === "bestsellers"
              ? "จัดตามขายดีจริง · กดค้างเมนู = ของหมด"
              : "กดค้างหมวด = ลากเรียง · กดค้างเมนู = ของหมด"}
          </span>
          {success ? <span className="ok-text pos-sell-flash">{success}</span> : null}
        </div>

        <PosSellCategoryBar
          categories={activeCategories}
          selectedId={categoryId}
          onSelect={setCategoryId}
          onReorder={menuArrangeMode === "bestsellers" ? undefined : commitCategoryReorder}
        />

        <div
          className={`pos-sell-grid ${
            visibleItems.length <= 9 ? "is-sparse" : "is-mid"
          }`}
        >
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
                  <PosLazyMenuImage url={item.imageUrl} className="pos-sell-item-img" />
                </div>
                <span className="pos-sell-item-caption">
                  <span className="pos-sell-item-name">
                    {item.name}
                  </span>
                  {soldOut ? (
                    <span className="pos-sell-item-soldout">ของหมด</span>
                  ) : (
                    <span className="pos-sell-item-price">฿{formatPlainNumber(item.price)}</span>
                  )}
                </span>
                {qty > 0 ? <span className="pos-sell-item-qty">×{qty}</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="pos-sell-cart-panel">
        <header className="pos-cart-head">
          <div className="pos-cart-head-top">
            <p className="pos-cart-head-title">ตะกร้า</p>
            {cartCount > 0 ? (
              <span className="pos-cart-head-count">{cartCount} รายการ</span>
            ) : null}
          </div>
          <span className="pos-cart-bill-id">#{session.id.slice(-5).toUpperCase()}</span>
        </header>

        <div className="pos-cart-scroll">
          <div className="pos-cart-lines">
          {cartLines.length ? (
            cartLines.map((l, lineIndex) => {
              const mods = cartModifierLines(l.selections);
              const lineTotal = l.unitPrice * l.qty;
              const canEditLine = lineHasEditableOptions(l, optionGroups);
              const showLineNo = cartLines.length > 1;
              return (
                <div
                  key={l.cartKey}
                  className={`pos-sell-cart-line ${canEditLine ? "is-editable" : ""}`}
                >
                  {showLineNo ? (
                    <span className="pos-cart-line-index" aria-hidden>
                      {lineIndex + 1}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`pos-cart-line-tap ${showLineNo ? "" : "pos-cart-line-tap--full"}`}
                    disabled={!canEditLine}
                    onClick={() => canEditLine && openEditCartLine(l)}
                    aria-label={canEditLine ? `แก้ไข ${l.item.name}` : undefined}
                  >
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
                      {canEditLine ? <span className="pos-cart-line-edit-hint">แตะเพื่อแก้ไข</span> : null}
                    </div>
                    <div className="pos-cart-line-side">
                      <span className="pos-cart-line-price">฿{formatPlainNumber(lineTotal)}</span>
                    </div>
                  </button>
                  <div className={`pos-sell-cart-line-actions ${showLineNo ? "" : "pos-sell-cart-line-actions--full"}`}>
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
              );
            })
          ) : (
            <p className="muted pos-cart-empty">แตะเมนูเพื่อเพิ่มรายการ</p>
          )}
          </div>
        </div>

        <footer className="pos-cart-foot">
          <div className="pos-cart-totals">
            {discountBaht > 0 ? (
              <>
                <div className="pos-cart-total-row pos-cart-total-row--sub">
                  <span className="pos-cart-total-label">รวม {cartCount} รายการ</span>
                  <span className="pos-cart-total-sub">฿{formatPlainNumber(subtotal)}</span>
                </div>
                <div className="pos-cart-total-row pos-cart-total-row--sub">
                  <span className="pos-cart-total-label">ส่วนลด</span>
                  <span className="pos-cart-total-discount">-฿{formatPlainNumber(discountBaht)}</span>
                </div>
              </>
            ) : null}
            <div className="pos-cart-total-row">
              <span className="pos-cart-total-label">
                {discountBaht > 0 ? "ยอดสุทธิ" : `${cartCount} รายการ`}
              </span>
              <strong className="pos-cart-total-amount">฿{formatPlainNumber(total)}</strong>
            </div>
          </div>
          <div className="pos-cart-actions-secondary">
            <button
              type="button"
              className="pos-cart-secondary-btn"
              disabled={!cartCount}
              onClick={() => setConfirmClearCart(true)}
            >
              <X size={14} aria-hidden />
              ล้างตะกร้า
            </button>
            <button
              type="button"
              className={`pos-cart-secondary-btn ${discountBaht > 0 ? "is-active" : ""}`}
              disabled={!cartCount}
              onClick={() => setDiscountOpen(true)}
            >
              <Tag size={14} aria-hidden />
              {discountBaht > 0 ? `ส่วนลด ฿${formatPlainNumber(discountBaht)}` : "ส่วนลด"}
            </button>
          </div>
          <div className="pos-cart-pay-alt">
            <button
              type="button"
              className="pos-btn-orange pos-cart-pay-main"
              disabled={!cartCount}
              onClick={openCashPay}
            >
              เงินสด · {formatPlainNumber(total)}
            </button>
            <button
              type="button"
              className="pos-cart-alt-btn"
              disabled={!cartCount}
              onClick={() => void openPromptPayPay()}
            >
              PromptPay
            </button>
          </div>
        </footer>
      </aside>

      {confirmClearCart ? (
        <PosConfirmDialog
          open
          title="ล้างตะกร้า?"
          message="ลบทุกรายการในตะกร้า — กดยืนยันถ้าสั่งผิดทั้งบิล"
          confirmLabel="ล้างตะกร้า"
          onCancel={() => setConfirmClearCart(false)}
          onConfirm={() => {
            setCart({});
            setCartDiscount(null);
            setConfirmClearCart(false);
          }}
        />
      ) : null}

      {confirmSoldOut ? (
        <PosConfirmDialog
          open
          title={confirmSoldOut.active ? "ปิดขายเมนูนี้?" : "เปิดขายอีกครั้ง?"}
          message={
            confirmSoldOut.active
              ? `"${confirmSoldOut.name}" จะแสดงเป็นของหมด`
              : `"${confirmSoldOut.name}" จะกลับมาขายได้`
          }
          confirmLabel="ยืนยัน"
          onCancel={() => setConfirmSoldOut(null)}
          onConfirm={() => void confirmSoldOutToggle()}
        />
      ) : null}

      {picker ? (
        <PosOptionPickerModal
          itemName={picker.item.name}
          imageUrl={picker.item.imageUrl}
          basePrice={picker.item.price}
          groups={optionGroupsForItem(picker.item, optionGroups)}
          initialSelections={picker.initialSelections}
          initialQty={picker.initialQty}
          onCancel={() => setPicker(null)}
          onConfirm={confirmPicker}
        />
      ) : null}

      {discountOpen ? (
        <PosDiscountModal
          subtotal={subtotal}
          initial={cartDiscount}
          onCancel={() => setDiscountOpen(false)}
          onApply={(next) => {
            setCartDiscount(next);
            setDiscountOpen(false);
          }}
        />
      ) : null}

      {payOpen ? (
        <div className="pos-pay-modal" role="dialog" aria-modal="true">
          <div className="pos-pay-sheet">
            <div className="pos-pay-sheet-inner">
              <div className="pos-pay-sheet-top">
                <div className="pos-pay-head">
                  <h2>{payMode === "promptpay" ? "สแกนจ่าย PromptPay" : "รับเงินสด"}</h2>
                  <button type="button" className="ghost-btn" aria-label="ปิด" onClick={closePay}>
                    <X size={18} />
                  </button>
                </div>
                <p className="pos-pay-summary">
                  {cartCount} รายการ · {payMode === "promptpay" ? "สแกนจ่าย" : "ชำระเงินสด"}
                </p>
              </div>

              <div className="pos-pay-order-scroll">
                <PosPayOrderReview
                  lines={cartLines}
                  total={total}
                  subtotal={subtotal}
                  discountBaht={discountBaht}
                />
              </div>

              <div className="pos-pay-sheet-body">
                {payMode === "cash" ? (
                  <PosCashKeypad total={total} value={cashInput} onChange={setCashInput} />
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
              </div>
            </div>

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
