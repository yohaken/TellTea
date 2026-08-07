import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { POS_SALES_COL } from "./pos-sales";
import { POS_SESSIONS_COL } from "./pos-session";
import type { PosSale, PosSession, PosSessionCashDropNote } from "./types";
import {
  bangkokMonthKey,
  dateKeysInMonth,
  isMonthKey,
  startMsFromDateKey,
} from "./vat-sales";
import { bangkokDateKey, startOfLocalDay } from "./utils";

/** Initial slim-table page size (scroll for the rest of the window). */
export const POS_SESSIONS_SLIM_LIMIT = 50;

/** Bills superslim window — newest first, load more on scroll. */
export const POS_BILLS_SLIM_PAGE = 25;

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
  const redeemBaht =
    typeof data.redeemBaht === "number" && data.redeemBaht > 0
      ? Math.round(data.redeemBaht * 100) / 100
      : 0;
  let manualDiscountBaht =
    typeof data.manualDiscountBaht === "number" && data.manualDiscountBaht > 0
      ? Math.round(data.manualDiscountBaht * 100) / 100
      : 0;
  if (!manualDiscountBaht && discountBaht > redeemBaht) {
    manualDiscountBaht = Math.round((discountBaht - redeemBaht) * 100) / 100;
  }
  return {
    id,
    billNo: typeof data.billNo === "string" ? data.billNo : "—",
    deviceId: typeof data.deviceId === "string" ? data.deviceId : "",
    sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
    date: typeof data.date === "number" ? data.date : 0,
    shift: typeof data.shift === "string" ? data.shift : "",
    lines: Array.isArray(data.lines) ? (data.lines as PosSale["lines"]) : [],
    subtotal,
    ...(manualDiscountBaht > 0 ? { manualDiscountBaht } : {}),
    ...(discountBaht > 0 ? { discountBaht } : {}),
    total,
    paymentMethod: normalizePaymentMethod(data.paymentMethod),
    ...(typeof data.transferRef === "string" && data.transferRef.trim()
      ? { transferRef: data.transferRef.trim() }
      : {}),
    ...(typeof data.memberId === "string" && data.memberId.trim()
      ? { memberId: data.memberId.trim() }
      : {}),
    ...(typeof data.memberPhone === "string" && data.memberPhone.trim()
      ? { memberPhone: data.memberPhone.trim() }
      : {}),
    ...(typeof data.pointsEarned === "number" && data.pointsEarned > 0
      ? { pointsEarned: data.pointsEarned }
      : {}),
    ...(typeof data.pointsRedeemed === "number" && data.pointsRedeemed > 0
      ? { pointsRedeemed: data.pointsRedeemed }
      : {}),
    ...(redeemBaht > 0 ? { redeemBaht } : {}),
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

function mapCashDropNotes(raw: unknown): PosSessionCashDropNote[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PosSessionCashDropNote[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const amount = typeof r.amount === "number" ? r.amount : Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out.push({
      amount,
      reason: typeof r.reason === "string" ? r.reason : "",
      at: typeof r.at === "number" && r.at > 0 ? r.at : 0,
    });
  }
  return out;
}

function mapSession(id: string, data: Record<string, unknown>): PosSession {
  const num = (key: string) =>
    typeof data[key] === "number" ? (data[key] as number) : undefined;
  const str = (key: string) =>
    typeof data[key] === "string" ? (data[key] as string) : undefined;
  const counted = num("closingCashCounted");
  const leave = num("leaveFloat");
  const remitStored = num("remitAmount");
  const remitAmount =
    remitStored != null
      ? remitStored
      : counted != null && leave != null
        ? Math.max(0, counted - leave)
        : undefined;
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
    closingCashCounted: counted,
    expectedCash: num("expectedCash"),
    cashDifference: num("cashDifference"),
    leaveFloat: leave,
    discountTotal: num("discountTotal"),
    voidedCount: num("voidedCount"),
    cashOutTotal: num("cashOutTotal"),
    cashInTotal: num("cashInTotal"),
    cashDropCount: num("cashDropCount"),
    cashDropNotes: mapCashDropNotes(data.cashDropNotes),
    discrepancyNote: str("discrepancyNote"),
    discrepancyLabel: str("discrepancyLabel"),
    remitAmount,
    remitStatus: (() => {
      const r = str("remitStatus");
      if (r === "pending" || r === "handed" || r === "mismatch") return r;
      return undefined;
    })(),
    remitHandedAmount: num("remitHandedAmount"),
    remitHandedAt: num("remitHandedAt"),
    remitHandedBy: str("remitHandedBy"),
    remitHandedByName: str("remitHandedByName"),
    remitReceivedByName: str("remitReceivedByName"),
    remitHandoffNote: str("remitHandoffNote"),
    cashBillCount: num("cashBillCount"),
    promptpayBillCount: num("promptpayBillCount"),
    transferBillCount: num("transferBillCount"),
    source: str("source"),
    counterLabel: str("counterLabel"),
    openedByEmployeeId: str("openedByEmployeeId"),
    openedByName: str("openedByName"),
    closedBy: str("closedBy"),
    closedByEmployeeId: str("closedByEmployeeId"),
    closedByName: str("closedByName"),
    closeSource: str("closeSource"),
  };
}

/** Display label for who closed the round — empty when still open / unknown. */
export function posSessionCloserLabel(session: PosSession): string {
  if (session.status !== "closed") return "";
  const name = (session.closedByName || "").trim();
  if (name) return name;
  const source = (session.closeSource || "").trim();
  if (source === "bo-force" || source === "bo-manual") return "BO";
  if ((session.closedBy || "").trim()) return "BO";
  return "";
}

/** Activity clock for sort — closedAt when closed, else openedAt. */
export function posSessionActivityAt(session: PosSession): number {
  if (session.status === "closed" && session.closedAt) return session.closedAt;
  return session.openedAt || session.closedAt || 0;
}

/** Newest activity first (open or closed). */
export function sortSessionsNewestFirst(sessions: PosSession[]): PosSession[] {
  return [...sessions].sort((a, b) => posSessionActivityAt(b) - posSessionActivityAt(a));
}

/** Open rounds first (latest open on top), then closed by newest close. */
export function sortSessionsOpenFirst(sessions: PosSession[]): PosSession[] {
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

/**
 * Calendar day newest → oldest (`date` Bangkok midnight), then latest activity in-day.
 * Slim `/pos-sales` table default.
 */
export function sortSessionsByDateNewestFirst(sessions: PosSession[]): PosSession[] {
  return [...sessions].sort((a, b) => {
    const aDay = a.date || 0;
    const bDay = b.date || 0;
    if (aDay !== bDay) return bDay - aDay;
    return posSessionActivityAt(b) - posSessionActivityAt(a);
  });
}

/** Open longer than this is flagged as stale (tea-bar day). */
export const POS_SESSION_STALE_OPEN_MS = 18 * 60 * 60 * 1000;

export type PosSessionDataIssue = {
  sessionId: string;
  label: string;
  issues: string[];
};

/**
 * Client-side scan of loaded sessions + bills — missing/skewed date, stale open,
 * inverted close, session totals ≠ bills.
 */
export function inspectPosSessionData(
  sessions: PosSession[],
  sales: PosSale[],
  nowMs = Date.now(),
): PosSessionDataIssue[] {
  const reconcile = reconcilePosSessions(sales, sessions);
  const byId = new Map(reconcile.map((r) => [r.session.id, r]));
  const out: PosSessionDataIssue[] = [];

  for (const session of sessions) {
    const issues: string[] = [];
    if (!session.date) {
      issues.push("ไม่มีวันที่รอบ");
    } else if (session.openedAt) {
      const expected = startOfLocalDay(new Date(session.openedAt));
      const legacyUtc = expected + 7 * 60 * 60 * 1000;
      if (
        session.date !== expected &&
        session.date !== legacyUtc &&
        Math.abs(session.date - expected) >= 20 * 60 * 60 * 1000
      ) {
        issues.push("วันที่รอบไม่ตรงเวลาเปิด");
      }
    }
    if (
      session.status === "closed" &&
      session.closedAt &&
      session.openedAt &&
      session.closedAt < session.openedAt
    ) {
      issues.push("เวลาปิดก่อนเวลาเปิด");
    }
    if (
      session.status === "open" &&
      session.openedAt &&
      nowMs - session.openedAt > POS_SESSION_STALE_OPEN_MS
    ) {
      issues.push("เปิดค้างนาน");
    }
    const rec = byId.get(session.id);
    if (rec && !rec.countMatch) {
      issues.push(`จำนวนบิลไม่ตรง (${rec.salesCount}≠${session.saleCount})`);
    }
    if (rec && !rec.totalMatch) {
      issues.push(
        `ยอดไม่ตรง (฿${rec.salesTotal}≠฿${session.totalSales})`,
      );
    }
    if (issues.length) {
      out.push({
        sessionId: session.id,
        label: posSessionCode(session.id),
        issues,
      });
    }
  }
  return out;
}

/** Elapsed open time, or closed−opened when closed. */
export function posSessionDurationMs(session: PosSession, nowMs = Date.now()): number {
  const openAt = session.openedAt || 0;
  if (!openAt) return 0;
  if (session.status === "closed" && session.closedAt && session.closedAt >= openAt) {
    return session.closedAt - openAt;
  }
  return Math.max(0, nowMs - openAt);
}

/** Compact Thai duration — e.g. `2ชม.15น.` · `45น.` · `12วิ` */
export function formatPosSessionDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}วิ`;
  const totalMin = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours <= 0) return `${mins}น.`;
  if (mins <= 0) return `${hours}ชม.`;
  return `${hours}ชม.${mins}น.`;
}

/** Owner-visible session code (not truncated to 6). */
export function posSessionCode(sessionId: string): string {
  const id = (sessionId || "").trim();
  if (!id) return "—";
  if (id.length <= 16) return id.toUpperCase();
  return id.slice(-12).toUpperCase();
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

  const sessionOrder = sortSessionsByDateNewestFirst(sessions);
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
  const legacyUtcDate = dateMs + 7 * 60 * 60 * 1000;
  let primary: PosSale[] = [];
  let legacy: PosSale[] = [];

  const emit = () => {
    const map = new Map<string, PosSale>();
    for (const s of primary) map.set(s.id, s);
    for (const s of legacy) map.set(s.id, s);
    onSales(
      [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    );
  };

  const unsub1 = onSnapshot(
    query(
      collection(getDb(), POS_SALES_COL),
      where("date", "==", dateMs),
      orderBy("createdAt", "desc"),
    ),
    (snap) => {
      primary = snap.docs.map((d) => mapPosSale(d.id, d.data() as Record<string, unknown>));
      emit();
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );

  const unsub2 = onSnapshot(
    query(
      collection(getDb(), POS_SALES_COL),
      where("date", "==", legacyUtcDate),
      orderBy("createdAt", "desc"),
    ),
    (snap) => {
      legacy = snap.docs.map((d) => mapPosSale(d.id, d.data() as Record<string, unknown>));
      emit();
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );

  return () => {
    unsub1();
    unsub2();
  };
}

/**
 * Live nPos sales cycles for a day — open + closed from `posSessions`.
 * Prefer {@link subscribePosSessionsRecent} for the slim overview (no date slider).
 */
export function subscribePosSessionsForDate(
  dateMs: number,
  onSessions: (sessions: PosSession[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const todayMs = startOfLocalDay();
  const isToday = dateMs === todayMs;
  const legacyUtcDate = dateMs + 7 * 60 * 60 * 1000;

  let byDate: PosSession[] = [];
  let byLegacy: PosSession[] = [];
  let openLive: PosSession[] = [];

  const emit = () => {
    const map = new Map<string, PosSession>();
    for (const s of byDate) map.set(s.id, s);
    for (const s of byLegacy) map.set(s.id, s);
    if (isToday) {
      for (const s of openLive) map.set(s.id, s);
    }
    onSessions(sortSessionsNewestFirst([...map.values()]));
  };

  const handleErr = (err: Error) => onError?.(err);

  const unsubDate = onSnapshot(
    query(collection(getDb(), POS_SESSIONS_COL), where("date", "==", dateMs)),
    (snap) => {
      byDate = snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>));
      emit();
    },
    (err) => handleErr(err instanceof Error ? err : new Error(String(err))),
  );

  const unsubLegacy = onSnapshot(
    query(collection(getDb(), POS_SESSIONS_COL), where("date", "==", legacyUtcDate)),
    (snap) => {
      byLegacy = snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>));
      emit();
    },
    (err) => handleErr(err instanceof Error ? err : new Error(String(err))),
  );

  let unsubOpen: Unsubscribe = () => {};
  if (isToday) {
    unsubOpen = onSnapshot(
      query(collection(getDb(), POS_SESSIONS_COL), where("status", "==", "open")),
      (snap) => {
        openLive = snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>));
        emit();
      },
      (err) => handleErr(err instanceof Error ? err : new Error(String(err))),
    );
  }

  return () => {
    unsubDate();
    unsubLegacy();
    unsubOpen();
  };
}

/**
 * Slim-super overview: newest ~50 sessions + all live open rounds.
 * No day slider — each row carries its own date column.
 */
export function subscribePosSessionsRecent(
  onSessions: (sessions: PosSession[]) => void,
  onError?: (err: Error) => void,
  rowLimit = POS_SESSIONS_SLIM_LIMIT,
): Unsubscribe {
  let recent: PosSession[] = [];
  let openLive: PosSession[] = [];

  const emit = () => {
    const map = new Map<string, PosSession>();
    for (const s of recent) map.set(s.id, s);
    for (const s of openLive) map.set(s.id, s);
    onSessions(sortSessionsByDateNewestFirst([...map.values()]).slice(0, rowLimit));
  };

  const handleErr = (err: Error) => onError?.(err);

  const unsubRecent = onSnapshot(
    query(
      collection(getDb(), POS_SESSIONS_COL),
      orderBy("openedAt", "desc"),
      limit(Math.max(rowLimit, POS_SESSIONS_SLIM_LIMIT)),
    ),
    (snap) => {
      recent = snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>));
      emit();
    },
    (err) => handleErr(err instanceof Error ? err : new Error(String(err))),
  );

  const unsubOpen = onSnapshot(
    query(collection(getDb(), POS_SESSIONS_COL), where("status", "==", "open")),
    (snap) => {
      openLive = snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>));
      emit();
    },
    (err) => handleErr(err instanceof Error ? err : new Error(String(err))),
  );

  return () => {
    unsubRecent();
    unsubOpen();
  };
}

/** Recent bills for slim overview (no date slider). Cap keeps the page fast. */
export function subscribePosSalesRecent(
  onSales: (sales: PosSale[]) => void,
  onError?: (err: Error) => void,
  rowLimit = 120,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(getDb(), POS_SALES_COL),
      orderBy("createdAt", "desc"),
      limit(Math.max(POS_BILLS_SLIM_PAGE * 2, rowLimit)),
    ),
    (snap) => {
      onSales(snap.docs.map((d) => mapPosSale(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

/** Max inclusive calendar days for BO dashboard range query. */
export const POS_DASHBOARD_MAX_RANGE_DAYS = 92;

export type PosDateRange = {
  /** Bangkok midnight ms (inclusive) */
  startMs: number;
  /** Bangkok midnight ms (inclusive) */
  endMs: number;
};

/** Default dashboard window: 1st of Bangkok month → today. */
export function defaultPosDashboardRange(nowMs = Date.now()): PosDateRange {
  return posDashboardMonthRange(bangkokMonthKey(nowMs), nowMs);
}

/**
 * Full calendar month in Bangkok.
 * Current month ends at today; past months use the last day of the month.
 */
export function posDashboardMonthRange(monthKey: string, nowMs = Date.now()): PosDateRange {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const keys = dateKeysInMonth(monthKey);
  const startMs = startMsFromDateKey(keys[0]);
  const monthEnd = startMsFromDateKey(keys[keys.length - 1]);
  const today = startOfLocalDay(nowMs);
  const endMs =
    monthKey === bangkokMonthKey(nowMs) ? Math.min(monthEnd, today) : monthEnd;
  return { startMs, endMs };
}

/** Shift YYYY-MM by whole months (can go past current — callers clamp). */
export function shiftPosMonthKey(monthKey: string, deltaMonths: number): string {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const [y, m] = monthKey.split("-").map(Number);
  const utc = Date.UTC(y, m - 1 + deltaMonths, 1);
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type PosDashMonthOption = { monthKey: string; label: string };

/** Recent Bangkok months newest-first for the dashboard month picker. */
export function listPosDashboardMonthOptions(
  nowMs = Date.now(),
  count = 24,
): PosDashMonthOption[] {
  const n = Math.max(1, Math.min(60, count));
  const cur = bangkokMonthKey(nowMs);
  const out: PosDashMonthOption[] = [];
  for (let i = 0; i < n; i++) {
    const monthKey = shiftPosMonthKey(cur, -i);
    const startMs = startMsFromDateKey(`${monthKey}-01`);
    const label = new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      month: "long",
      year: "numeric",
    }).format(new Date(startMs + 12 * 60 * 60 * 1000));
    out.push({ monthKey, label });
  }
  return out;
}

/**
 * If the range is exactly a dashboard month window, return that YYYY-MM; else null
 * (custom from–to).
 */
export function posRangeMatchedMonthKey(
  range: PosDateRange,
  nowMs = Date.now(),
): string | null {
  const { startMs, endMs } = normalizePosDateRange(range);
  const startKey = bangkokDateKey(startMs);
  if (!/^\d{4}-\d{2}-01$/.test(startKey)) return null;
  const monthKey = startKey.slice(0, 7);
  try {
    const expected = posDashboardMonthRange(monthKey, nowMs);
    if (expected.startMs === startMs && expected.endMs === endMs) return monthKey;
  } catch {
    return null;
  }
  return null;
}

/** Order start/end as Bangkok midnights — does not enforce max span. */
export function normalizePosDateRange(range: PosDateRange): PosDateRange {
  let startMs = startOfLocalDay(range.startMs);
  let endMs = startOfLocalDay(range.endMs);
  if (endMs < startMs) {
    const tmp = startMs;
    startMs = endMs;
    endMs = tmp;
  }
  return { startMs, endMs };
}

/** Inclusive calendar-day count without max-span clamp (for validation). */
export function posDateRangeDayCountRaw(range: PosDateRange): number {
  const { startMs, endMs } = normalizePosDateRange(range);
  return Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
}

/** Normalize + clamp to {@link POS_DASHBOARD_MAX_RANGE_DAYS} (safety for queries). */
export function clampPosDateRange(range: PosDateRange): PosDateRange {
  const { startMs, endMs } = normalizePosDateRange(range);
  const maxSpan = (POS_DASHBOARD_MAX_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000;
  if (endMs - startMs > maxSpan) {
    return { startMs: endMs - maxSpan, endMs };
  }
  return { startMs, endMs };
}

export function posDateRangeDayCount(range: PosDateRange): number {
  return posDateRangeDayCountRaw(clampPosDateRange(range));
}

/** Gregorian DD/MM/YYYY for one Bangkok day. */
export function formatPosRangeDayCe(ms: number): string {
  const key = bangkokDateKey(ms);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** `01/07/2026 - 31/07/2026` style label. */
export function formatPosDateRangeLabel(range: PosDateRange): string {
  const { startMs, endMs } = clampPosDateRange(range);
  return `${formatPosRangeDayCe(startMs)} - ${formatPosRangeDayCe(endMs)}`;
}

/** YYYY-MM-DD for `<input type="date">` from Bangkok midnight ms. */
export function posRangeDayInputValue(ms: number): string {
  return bangkokDateKey(startOfLocalDay(ms)) || "";
}

/**
 * Live bills for a Bangkok date range (inclusive midnights).
 * Merges legacy UTC+7 twin `date` stamps the same way as single-day subscribe.
 */
export function subscribePosSalesForDateRange(
  range: PosDateRange,
  onSales: (sales: PosSale[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const { startMs, endMs } = clampPosDateRange(range);
  const legacyStart = startMs + 7 * 60 * 60 * 1000;
  const legacyEnd = endMs + 7 * 60 * 60 * 1000;

  let primary: PosSale[] = [];
  let legacy: PosSale[] = [];
  let primaryReady = false;
  let legacyReady = false;

  const emit = () => {
    // Wait for both twin queries so the dashboard does not flash empty/under-count.
    if (!primaryReady || !legacyReady) return;
    const map = new Map<string, PosSale>();
    for (const s of primary) map.set(s.id, s);
    for (const s of legacy) map.set(s.id, s);
    onSales(
      [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    );
  };

  const handleErr = (err: Error) => onError?.(err);

  const unsub1 = onSnapshot(
    query(
      collection(getDb(), POS_SALES_COL),
      where("date", ">=", startMs),
      where("date", "<=", endMs),
    ),
    (snap) => {
      primary = snap.docs.map((d) => mapPosSale(d.id, d.data() as Record<string, unknown>));
      primaryReady = true;
      emit();
    },
    (err) => handleErr(err instanceof Error ? err : new Error(String(err))),
  );

  const unsub2 = onSnapshot(
    query(
      collection(getDb(), POS_SALES_COL),
      where("date", ">=", legacyStart),
      where("date", "<=", legacyEnd),
    ),
    (snap) => {
      legacy = snap.docs.map((d) => mapPosSale(d.id, d.data() as Record<string, unknown>));
      legacyReady = true;
      emit();
    },
    (err) => handleErr(err instanceof Error ? err : new Error(String(err))),
  );

  return () => {
    unsub1();
    unsub2();
  };
}

export function shiftDayMs(offsetDays = 0): number {
  return startOfLocalDay() + offsetDays * 24 * 60 * 60 * 1000;
}

/** POS report day label — Asia/Bangkok, พ.ศ. year (no device-TZ drift). */
export function formatPosReportDate(ms: number): string {
  if (!ms) return "—";
  const weekday = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
  }).format(new Date(ms));
  const month = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    month: "short",
  }).format(new Date(ms));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const day = Number(get("day"));
  const yearCe = Number(get("year"));
  if (!day || !yearCe) return "—";
  return `${weekday} ${day} ${month} ${yearCe + 543}`;
}
