import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { daysAgoMs } from "./query-window";
import type {
  StockCountLine,
  StockCountRound,
  StockCountSession,
  StockCountSessionInput,
} from "./types";

const SESSIONS_COL = "stockCountSessions";

export const STOCK_COUNT_ROUNDS: StockCountRound[] = [1, 10, 20];

/** นับสต๊อก ~2–3 รอบ/เดือน แต่เอกสารหนา — โหลดแค่ ~13 เดือน */
export const STOCK_COUNT_LOOKBACK_DAYS = 400;

export function stockCountSinceMs(
  now = Date.now(),
  days: number = STOCK_COUNT_LOOKBACK_DAYS,
): number {
  return daysAgoMs(days, now);
}

export function stockCountSessionId(year: number, month: number, dayOfMonth: StockCountRound) {
  const m = String(month + 1).padStart(2, "0");
  return `${year}-${m}-${dayOfMonth}`;
}

export function roundDateMs(year: number, month: number, dayOfMonth: StockCountRound) {
  return new Date(year, month, dayOfMonth).getTime();
}

function mapSessionDoc(id: string, data: Record<string, unknown>): StockCountSession {
  const linesRaw = Array.isArray(data.lines) ? data.lines : [];
  const lines: StockCountLine[] = linesRaw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      itemId: String(r.itemId || ""),
      itemName: String(r.itemName || ""),
      qty: Number(r.qty) || 0,
    };
  });
  return {
    id,
    date: Number(data.date) || 0,
    dayOfMonth: (Number(data.dayOfMonth) || 1) as StockCountRound,
    year: Number(data.year) || 0,
    month: Number(data.month) || 0,
    inspector: String(data.inspector || ""),
    inspectorId: data.inspectorId ? String(data.inspectorId) : undefined,
    submittedAt: Number(data.submittedAt) || 0,
    createdBy: String(data.createdBy || ""),
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    updatedAt: data.updatedAt != null ? Number(data.updatedAt) || undefined : undefined,
    lines,
  };
}

export function subscribeStockCountSessions(
  onData: (rows: StockCountSession[]) => void,
  onError?: (err: Error) => void,
  opts?: { since?: number },
): Unsubscribe {
  const since = opts?.since;
  const q =
    since != null
      ? query(
          collection(getDb(), SESSIONS_COL),
          where("date", ">=", since),
          orderBy("date", "desc"),
        )
      : query(collection(getDb(), SESSIONS_COL), orderBy("date", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => mapSessionDoc(d.id, d.data() as Record<string, unknown>)));
    },
    (err) => onError?.(err),
  );
}

export async function getSessionForRound(
  year: number,
  month: number,
  dayOfMonth: StockCountRound,
): Promise<StockCountSession | null> {
  const id = stockCountSessionId(year, month, dayOfMonth);
  const snap = await getDoc(doc(getDb(), SESSIONS_COL, id));
  if (!snap.exists()) return null;
  return mapSessionDoc(snap.id, snap.data() as Record<string, unknown>);
}

export async function submitStockCountSession(input: StockCountSessionInput): Promise<string> {
  if (!input.lines.length) throw new Error("ไม่มีรายการนับ");
  const id = stockCountSessionId(input.year, input.month, input.dayOfMonth);
  const ref = doc(getDb(), SESSIONS_COL, id);
  const existing = await getDoc(ref);
  const now = Date.now();
  const prev = existing.exists() ? (existing.data() as Record<string, unknown>) : null;
  const payload = {
    date: input.date,
    dayOfMonth: input.dayOfMonth,
    year: input.year,
    month: input.month,
    inspector: input.inspector.trim(),
    inspectorId: input.inspectorId || null,
    // แก้รอบเดิม: คงเวลา/คนสร้างแรก · อัปเดต updatedBy
    submittedAt: prev ? Number(prev.submittedAt) || input.submittedAt : input.submittedAt,
    createdBy: prev ? String(prev.createdBy || input.createdBy) : input.createdBy,
    updatedBy: input.createdBy,
    lines: input.lines.map((line) => ({
      itemId: line.itemId,
      itemName: line.itemName.trim(),
      qty: Number(line.qty) || 0,
    })),
    updatedAt: now,
  };
  if (!payload.inspector) throw new Error("ต้องเลือกผู้ตรวจนับ");
  await setDoc(ref, payload);
  // ปักเข้าหลังสุดจากงานจริง — มือถือเปิดคีย์บอร์ดมักทำให้ heartbeat (visibility) เงียบ
  const { touchStaffPresenceFromActor } = await import("./staff-presence");
  await touchStaffPresenceFromActor(String(payload.updatedBy || payload.createdBy || ""));
  return id;
}

export async function deleteStockCountSession(sessionId: string): Promise<void> {
  await deleteDoc(doc(getDb(), SESSIONS_COL, sessionId));
}

/** Owner: wipe all count sessions */
export async function deleteAllStockCountSessions(): Promise<number> {
  const snap = await getDocs(collection(getDb(), SESSIONS_COL));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  return snap.docs.length;
}

export function qtyForItem(session: StockCountSession | null, itemId: string): number | null {
  if (!session) return null;
  const line = session.lines.find((l) => l.itemId === itemId);
  return line != null ? line.qty : null;
}

export function sessionsInMonth(
  sessions: StockCountSession[],
  year: number,
  month: number,
): StockCountSession[] {
  return sessions.filter((s) => s.year === year && s.month === month);
}

export function latestSessionByRound(
  sessions: StockCountSession[],
): Map<string, StockCountSession> {
  const map = new Map<string, StockCountSession>();
  for (const s of sessions) {
    const key = `${s.year}-${s.month}-${s.dayOfMonth}`;
    const existing = map.get(key);
    if (!existing || s.submittedAt > existing.submittedAt) {
      map.set(key, s);
    }
  }
  return map;
}

export async function listSessionsSince(sinceMs: number): Promise<StockCountSession[]> {
  const snap = await getDocs(
    query(collection(getDb(), SESSIONS_COL), where("date", ">=", sinceMs), orderBy("date", "desc")),
  );
  return snap.docs.map((d) => mapSessionDoc(d.id, d.data() as Record<string, unknown>));
}
