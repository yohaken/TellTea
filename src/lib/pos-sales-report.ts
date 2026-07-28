import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { POS_SALES_COL } from "./pos-sales";
import { POS_SESSIONS_COL } from "./pos-session";
import type { PosSale, PosSession } from "./types";
import { startOfLocalDay } from "./utils";

/** สรุปรอบขาย nPos (ไม่ใช่กะ OT เช้า/เย็น) */
export type PosSessionSalesRow = {
  sessionId: string;
  label: string;
  status: "open" | "closed";
  count: number;
  total: number;
  cashTotal: number;
  promptpayTotal: number;
  transferTotal: number;
};

/** @deprecated OT window — do not use for sales overview */
export type PosShiftSalesRow = {
  shift: string;
  label: string;
  count: number;
  total: number;
  cashTotal: number;
  promptpayTotal: number;
  transferTotal: number;
};

export type PosMenuSalesRow = {
  menuItemId: string;
  name: string;
  qty: number;
  total: number;
};

export type PosSalesDetailedSummary = {
  activeCount: number;
  voidedCount: number;
  voidedTotal: number;
  total: number;
  grossTotal: number;
  discountTotal: number;
  discountCount: number;
  cashTotal: number;
  cashCount: number;
  promptpayTotal: number;
  promptpayCount: number;
  transferTotal: number;
  transferCount: number;
  /** สรุปตามรอบขาย nPos (sessionId) */
  bySession: PosSessionSalesRow[];
  /** @deprecated kept empty for older callers */
  byShift: PosShiftSalesRow[];
  topItems: PosMenuSalesRow[];
};

export type PosSessionReconcileRow = {
  session: PosSession;
  salesCount: number;
  salesTotal: number;
  countMatch: boolean;
  totalMatch: boolean;
};

/** Short display id for a sales cycle — not OT morning/evening. */
export function shortPosSessionId(sessionId: string): string {
  const id = (sessionId || "").trim();
  if (!id) return "—";
  const tail = id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : id;
  const slice = (tail.length >= 6 ? tail.slice(-6) : id.slice(-6)).toUpperCase();
  return `#${slice}`;
}

function normalizePaymentMethod(raw: unknown): PosSale["paymentMethod"] {
  const m = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (m === "promptpay") return "promptpay";
  if (m === "transfer" || m === "bank" || m === "bank_transfer") return "transfer";
  return "cash";
}

function resolveSaleDiscountBaht(data: Record<string, unknown>, subtotal: number, total: number): number {
  if (typeof data.discountBaht === "number" && data.discountBaht > 0) {
    return Math.round(data.discountBaht * 100) / 100;
  }
  const inferred = Math.round((subtotal - total) * 100) / 100;
  return inferred > 0.004 ? inferred : 0;
}

function mapPosSale(id: string, data: Record<string, unknown>): PosSale {
  const subtotal = typeof data.subtotal === "number" ? data.subtotal : 0;
  const total = typeof data.total === "number" ? data.total : 0;
  const discountBaht = resolveSaleDiscountBaht(data, subtotal, total);
  return {
    id,
    billNo: typeof data.billNo === "string" ? data.billNo : "—",
    deviceId: typeof data.deviceId === "string" ? data.deviceId : "",
    sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
    date: typeof data.date === "number" ? data.date : 0,
    shift: typeof data.shift === "string" ? data.shift : "",
    lines: Array.isArray(data.lines) ? (data.lines as PosSale["lines"]) : [],
    subtotal,
    ...(discountBaht > 0 ? { discountBaht } : {}),
    total,
    paymentMethod: normalizePaymentMethod(data.paymentMethod),
    ...(typeof data.transferRef === "string" && data.transferRef.trim()
      ? { transferRef: data.transferRef.trim() }
      : {}),
    cashReceived: typeof data.cashReceived === "number" ? data.cashReceived : 0,
    change: typeof data.change === "number" ? data.change : 0,
    ledgerEntryId: typeof data.ledgerEntryId === "string" ? data.ledgerEntryId : undefined,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    status: data.status === "voided" ? "voided" : "completed",
    voidedAt: typeof data.voidedAt === "number" ? data.voidedAt : undefined,
    voidedBy: typeof data.voidedBy === "string" ? data.voidedBy : undefined,
    voidReason: typeof data.voidReason === "string" ? data.voidReason : undefined,
    voidLedgerEntryId:
      typeof data.voidLedgerEntryId === "string" ? data.voidLedgerEntryId : undefined,
  };
}

function mapSession(id: string, data: Record<string, unknown>): PosSession {
  const num = (key: string) =>
    typeof data[key] === "number" ? (data[key] as number) : undefined;
  const str = (key: string) =>
    typeof data[key] === "string" ? (data[key] as string) : undefined;
  return {
    id,
    deviceId: typeof data.deviceId === "string" ? data.deviceId : "",
    date: typeof data.date === "number" ? data.date : 0,
    shift: typeof data.shift === "string" ? data.shift : "",
    openedAt: typeof data.openedAt === "number" ? data.openedAt : 0,
    closedAt: typeof data.closedAt === "number" ? data.closedAt : undefined,
    status: data.status === "closed" ? "closed" : "open",
    saleCount: typeof data.saleCount === "number" ? data.saleCount : 0,
    totalSales: typeof data.totalSales === "number" ? data.totalSales : 0,
    openingCash: num("openingCash"),
    cashTotal: num("cashTotal"),
    promptpayTotal: num("promptpayTotal"),
    transferTotal: num("transferTotal"),
    closingCashCounted: num("closingCashCounted"),
    expectedCash: num("expectedCash"),
    cashDifference: num("cashDifference"),
    leaveFloat: num("leaveFloat"),
    discountTotal: num("discountTotal"),
    voidedCount: num("voidedCount"),
    cashOutTotal: num("cashOutTotal"),
    cashInTotal: num("cashInTotal"),
    cashDropCount: num("cashDropCount"),
    discrepancyNote: str("discrepancyNote"),
    discrepancyLabel: str("discrepancyLabel"),
    source: str("source"),
  };
}

function sortSessionsOpenFirst(sessions: PosSession[]): PosSession[] {
  return [...sessions].sort((a, b) => {
    const aOpen = a.status === "open" ? 1 : 0;
    const bOpen = b.status === "open" ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    if (a.status === "open") return (b.openedAt || 0) - (a.openedAt || 0);
    const aClosed = a.closedAt || a.openedAt || 0;
    const bClosed = b.closedAt || b.openedAt || 0;
    return bClosed - aClosed;
  });
}

/** บิลในรอบ (active) — ใช้กับการ์ดหลังบ้าน */
export function salesForSession(sales: PosSale[], sessionId: string): PosSale[] {
  return sales.filter((s) => s.sessionId === sessionId && s.status === "completed");
}

export function voidedForSession(sales: PosSale[], sessionId: string): PosSale[] {
  return sales.filter((s) => s.sessionId === sessionId && s.status === "voided");
}

export function summarizePosSalesDetailed(
  sales: PosSale[],
  sessions: PosSession[] = [],
): PosSalesDetailedSummary {
  const active = sales.filter((s) => s.status === "completed");
  const voided = sales.filter((s) => s.status === "voided");

  const cashSales = active.filter((s) => s.paymentMethod === "cash");
  const ppSales = active.filter((s) => s.paymentMethod === "promptpay");
  const transferSales = active.filter((s) => s.paymentMethod === "transfer");

  const sessionOrder = sortSessionsOpenFirst(sessions);
  const knownIds = new Set(sessionOrder.map((s) => s.id));
  const orphanIds = [
    ...new Set(active.map((s) => s.sessionId).filter((id) => id && !knownIds.has(id))),
  ];

  const bySession: PosSessionSalesRow[] = [
    ...sessionOrder.map((session) => {
      const rows = active.filter((s) => s.sessionId === session.id);
      const cashRows = rows.filter((s) => s.paymentMethod === "cash");
      const ppRows = rows.filter((s) => s.paymentMethod === "promptpay");
      const transferRows = rows.filter((s) => s.paymentMethod === "transfer");
      return {
        sessionId: session.id,
        label: `${shortPosSessionId(session.id)}${session.status === "open" ? " · เปิด" : " · ปิด"}`,
        status: session.status,
        count: rows.length,
        total: rows.reduce((sum, s) => sum + s.total, 0),
        cashTotal: cashRows.reduce((sum, s) => sum + s.total, 0),
        promptpayTotal: ppRows.reduce((sum, s) => sum + s.total, 0),
        transferTotal: transferRows.reduce((sum, s) => sum + s.total, 0),
      };
    }),
    ...orphanIds.map((sessionId) => {
      const rows = active.filter((s) => s.sessionId === sessionId);
      const cashRows = rows.filter((s) => s.paymentMethod === "cash");
      const ppRows = rows.filter((s) => s.paymentMethod === "promptpay");
      const transferRows = rows.filter((s) => s.paymentMethod === "transfer");
      return {
        sessionId,
        label: `${shortPosSessionId(sessionId)} · บิล`,
        status: "closed" as const,
        count: rows.length,
        total: rows.reduce((sum, s) => sum + s.total, 0),
        cashTotal: cashRows.reduce((sum, s) => sum + s.total, 0),
        promptpayTotal: ppRows.reduce((sum, s) => sum + s.total, 0),
        transferTotal: transferRows.reduce((sum, s) => sum + s.total, 0),
      };
    }),
  ];

  const itemMap = new Map<string, PosMenuSalesRow>();
  for (const sale of active) {
    for (const line of sale.lines) {
      const key = line.menuItemId || line.name;
      const row = itemMap.get(key) || {
        menuItemId: line.menuItemId,
        name: line.name,
        qty: 0,
        total: 0,
      };
      row.qty += line.qty;
      row.total = Math.round((row.total + line.price * line.qty) * 100) / 100;
      itemMap.set(key, row);
    }
  }

  const topItems = [...itemMap.values()]
    .sort((a, b) => b.total - a.total || b.qty - a.qty)
    .slice(0, 8);

  const discountTotal = Math.round(
    active.reduce((sum, s) => sum + Math.max(0, s.discountBaht || 0), 0) * 100,
  ) / 100;
  const discountCount = active.filter((s) => (s.discountBaht || 0) > 0).length;
  const netTotal = active.reduce((sum, s) => sum + s.total, 0);
  const grossTotal = Math.round((netTotal + discountTotal) * 100) / 100;

  return {
    activeCount: active.length,
    voidedCount: voided.length,
    voidedTotal: voided.reduce((sum, s) => sum + s.total, 0),
    total: netTotal,
    grossTotal,
    discountTotal,
    discountCount,
    cashTotal: cashSales.reduce((sum, s) => sum + s.total, 0),
    cashCount: cashSales.length,
    promptpayTotal: ppSales.reduce((sum, s) => sum + s.total, 0),
    promptpayCount: ppSales.length,
    transferTotal: transferSales.reduce((sum, s) => sum + s.total, 0),
    transferCount: transferSales.length,
    bySession,
    byShift: [],
    topItems,
  };
}

export function reconcilePosSessions(sales: PosSale[], sessions: PosSession[]): PosSessionReconcileRow[] {
  return sessions.map((session) => {
    const sessionSales = sales.filter(
      (s) => s.sessionId === session.id && s.status === "completed",
    );
    const salesCount = sessionSales.length;
    const salesTotal = Math.round(sessionSales.reduce((sum, s) => sum + s.total, 0) * 100) / 100;
    return {
      session,
      salesCount,
      salesTotal,
      countMatch: salesCount === session.saleCount,
      totalMatch: salesTotal === session.totalSales,
    };
  });
}

export function subscribePosSalesForDate(
  dateMs: number,
  onSales: (sales: PosSale[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getDb(), POS_SALES_COL),
    where("date", "==", dateMs),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      onSales(snap.docs.map((d) => mapPosSale(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/**
 * Live nPos sales cycles for a day — open + closed from `posSessions`.
 * Sorted client-side (open first, newest closed); not OT morning/evening order.
 */
export function subscribePosSessionsForDate(
  dateMs: number,
  onSessions: (sessions: PosSession[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(collection(getDb(), POS_SESSIONS_COL), where("date", "==", dateMs));
  return onSnapshot(
    q,
    (snap) => {
      const mapped = snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>));
      onSessions(sortSessionsOpenFirst(mapped));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function shiftDayMs(offsetDays = 0): number {
  const d = new Date(startOfLocalDay());
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

export function formatPosReportDate(ms: number): string {
  return new Date(ms).toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
