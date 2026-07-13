import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { OT_SHIFTS, type OtShiftId } from "./ot";
import { POS_SALES_COL } from "./pos-sales";
import { POS_SESSIONS_COL } from "./pos-session";
import type { PosSale, PosSession } from "./types";
import { startOfLocalDay } from "./utils";

export type PosShiftSalesRow = {
  shift: OtShiftId;
  label: string;
  count: number;
  total: number;
  cashTotal: number;
  promptpayTotal: number;
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
  cashTotal: number;
  cashCount: number;
  promptpayTotal: number;
  promptpayCount: number;
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

function mapPosSale(id: string, data: Record<string, unknown>): PosSale {
  return {
    id,
    billNo: typeof data.billNo === "string" ? data.billNo : "—",
    deviceId: typeof data.deviceId === "string" ? data.deviceId : "",
    sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
    date: typeof data.date === "number" ? data.date : 0,
    shift: typeof data.shift === "string" ? data.shift : "",
    lines: Array.isArray(data.lines) ? (data.lines as PosSale["lines"]) : [],
    subtotal: typeof data.subtotal === "number" ? data.subtotal : 0,
    total: typeof data.total === "number" ? data.total : 0,
    paymentMethod: data.paymentMethod === "promptpay" ? "promptpay" : "cash",
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
  };
}

export function summarizePosSalesDetailed(sales: PosSale[]): PosSalesDetailedSummary {
  const active = sales.filter((s) => s.status === "completed");
  const voided = sales.filter((s) => s.status === "voided");

  const cashSales = active.filter((s) => s.paymentMethod === "cash");
  const ppSales = active.filter((s) => s.paymentMethod === "promptpay");

  const byShift: PosShiftSalesRow[] = OT_SHIFTS.map(({ id, label }) => {
    const rows = active.filter((s) => s.shift === id);
    const cashRows = rows.filter((s) => s.paymentMethod === "cash");
    const ppRows = rows.filter((s) => s.paymentMethod === "promptpay");
    return {
      shift: id,
      label,
      count: rows.length,
      total: rows.reduce((sum, s) => sum + s.total, 0),
      cashTotal: cashRows.reduce((sum, s) => sum + s.total, 0),
      promptpayTotal: ppRows.reduce((sum, s) => sum + s.total, 0),
    };
  });

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

  return {
    activeCount: active.length,
    voidedCount: voided.length,
    voidedTotal: voided.reduce((sum, s) => sum + s.total, 0),
    total: active.reduce((sum, s) => sum + s.total, 0),
    cashTotal: cashSales.reduce((sum, s) => sum + s.total, 0),
    cashCount: cashSales.length,
    promptpayTotal: ppSales.reduce((sum, s) => sum + s.total, 0),
    promptpayCount: ppSales.length,
    byShift,
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

export function subscribePosSessionsForDate(
  dateMs: number,
  onSessions: (sessions: PosSession[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(getDb(), POS_SESSIONS_COL),
    where("date", "==", dateMs),
    orderBy("shift", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      onSessions(snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>)));
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
