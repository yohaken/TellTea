import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getCurrentShiftId } from "./shift-session";
import { getPosDb } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import type { PosSession } from "./types";
import { startOfLocalDay } from "./utils";
import type { OtShiftId } from "./ot";

export const POS_SESSIONS_COL = "posSessions";

export function posSessionDocId(deviceId: string, date = Date.now(), shift = getCurrentShiftId()) {
  return `${deviceId}_${startOfLocalDay(new Date(date))}_${shift}`;
}

function sessionRef(id: string) {
  return doc(getPosDb(), POS_SESSIONS_COL, id);
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

export async function openPosSession(deviceId: string, shift: OtShiftId = getCurrentShiftId()): Promise<PosSession> {
  const date = startOfLocalDay();
  const id = posSessionDocId(deviceId, date, shift);
  const now = Date.now();
  const payload = {
    deviceId,
    date,
    shift,
    openedAt: now,
    status: "open",
    saleCount: 0,
    totalSales: 0,
    updatedAt: now,
  };
  try {
    await setDoc(sessionRef(id), payload, { merge: true });
    return mapSession(id, payload);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "เปิดรอบขาย", "pos"));
  }
}

export async function getPosSession(sessionId: string): Promise<PosSession | null> {
  const snap = await getDoc(sessionRef(sessionId));
  if (!snap.exists()) return null;
  return mapSession(snap.id, snap.data() as Record<string, unknown>);
}

export async function getCurrentPosSession(deviceId: string): Promise<PosSession | null> {
  const id = posSessionDocId(deviceId);
  return getPosSession(id);
}

export function subscribePosSession(
  sessionId: string,
  onSession: (session: PosSession | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    sessionRef(sessionId),
    (snap) => {
      onSession(snap.exists() ? mapSession(snap.id, snap.data() as Record<string, unknown>) : null);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function bumpPosSessionTotals(sessionId: string, saleTotal: number): Promise<void> {
  await adjustPosSessionTotals(sessionId, saleTotal, 1);
}

export async function adjustPosSessionTotals(
  sessionId: string,
  totalDelta: number,
  countDelta: number,
): Promise<void> {
  const snap = await getDoc(sessionRef(sessionId));
  if (!snap.exists()) return;
  const data = snap.data() as Record<string, unknown>;
  const saleCount = Math.max(0, (typeof data.saleCount === "number" ? data.saleCount : 0) + countDelta);
  const totalSales = Math.max(
    0,
    Math.round(
      ((typeof data.totalSales === "number" ? data.totalSales : 0) + totalDelta) * 100,
    ) / 100,
  );
  await setDoc(sessionRef(sessionId), { saleCount, totalSales, updatedAt: Date.now() }, { merge: true });
}

export async function closePosSession(sessionId: string): Promise<PosSession> {
  const snap = await getDoc(sessionRef(sessionId));
  if (!snap.exists()) throw new Error("ไม่พบรอบการขาย");
  const data = snap.data() as Record<string, unknown>;
  const now = Date.now();
  const payload = {
    ...data,
    status: "closed",
    closedAt: now,
    updatedAt: now,
  };
  await setDoc(sessionRef(sessionId), payload, { merge: true });
  return mapSession(sessionId, payload);
}
