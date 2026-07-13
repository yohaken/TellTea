import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getCurrentShiftId } from "./shift-session";
import { getPosDb } from "./pos-firebase";
import type { PosSession } from "./types";
import { startOfLocalDay } from "./utils";
import type { OtShiftId } from "./ot";
import { withTimeout } from "./pos-timeout";

export const POS_SESSIONS_COL = "posSessions";

const ACTIVE_SESSION_KEY = "telltea-pos-active-session";
const LOCAL_OPEN_SESSION_KEY = "telltea-pos-local-open-session";
const PENDING_CLOSED_SESSION_KEY = "telltea-pos-pending-closed-session";

function localOpenSessionStorageKey(deviceId: string) {
  return `${LOCAL_OPEN_SESSION_KEY}:${deviceId}`;
}

function pendingClosedStorageKey(deviceId: string) {
  return `${PENDING_CLOSED_SESSION_KEY}:${deviceId}`;
}

function readPendingClosedSession(deviceId: string): PosSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(pendingClosedStorageKey(deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PosSession;
    if (parsed?.deviceId !== deviceId || parsed.status !== "closed") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingClosedSession(deviceId: string, session: PosSession | null) {
  if (typeof localStorage === "undefined") return;
  const key = pendingClosedStorageKey(deviceId);
  if (!session) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(session));
}

export function readLocalOpenPosSession(deviceId: string): PosSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(localOpenSessionStorageKey(deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PosSession;
    if (parsed?.deviceId !== deviceId || parsed.status !== "open") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalOpenPosSession(deviceId: string, session: PosSession | null) {
  if (typeof localStorage === "undefined") return;
  try {
    const key = localOpenSessionStorageKey(deviceId);
    if (!session || session.status !== "open") {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function patchLocalOpenPosSession(
  deviceId: string,
  patch: Partial<Pick<PosSession, "saleCount" | "totalSales" | "status" | "closedAt">>,
): PosSession | null {
  const cur = readLocalOpenPosSession(deviceId);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  if (next.status !== "open") {
    writeLocalOpenPosSession(deviceId, null);
    return null;
  }
  writeLocalOpenPosSession(deviceId, next);
  return next;
}

function activeSessionStorageKey(deviceId: string) {
  return `${ACTIVE_SESSION_KEY}:${deviceId}`;
}

export function readStoredPosSessionId(deviceId: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(activeSessionStorageKey(deviceId));
  } catch {
    return null;
  }
}

export function storePosSessionId(deviceId: string, sessionId: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(activeSessionStorageKey(deviceId), sessionId);
  } catch {
    /* ignore */
  }
}

export function clearStoredPosSessionId(deviceId: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(activeSessionStorageKey(deviceId));
  } catch {
    /* ignore */
  }
}

/** รอบขายใหม่ — อิงเวลาเข้างานจริง (ไม่ผูกกับช่วงกะคงที่) */
export function posSessionDocId(deviceId: string, openedAt = Date.now()) {
  return `${deviceId}_${openedAt}`;
}

/** รูปแบบเก่า (device+วัน+กะ) — ใช้ค้นหาย้อนหลัง */
export function legacyPosSessionDocId(
  deviceId: string,
  date = Date.now(),
  shift = getCurrentShiftId(new Date(date)),
) {
  return `${deviceId}_${startOfLocalDay(new Date(date))}_${shift}`;
}

function sessionRef(id: string) {
  return doc(getPosDb(), POS_SESSIONS_COL, id);
}

function sessionsCol() {
  return collection(getPosDb(), POS_SESSIONS_COL);
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

export async function findOpenPosSession(deviceId: string): Promise<PosSession | null> {
  try {
    const q = query(
      sessionsCol(),
      where("deviceId", "==", deviceId),
      where("status", "==", "open"),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docSnap = snap.docs[0]!;
    return mapSession(docSnap.id, docSnap.data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** เข้างานทันทีบนเครื่อง — ไม่รอ Firestore */
export function startPosSessionLocal(deviceId: string, shift: OtShiftId = getCurrentShiftId()): PosSession {
  const existing = readLocalOpenPosSession(deviceId);
  if (existing) return existing;

  const now = Date.now();
  const session = mapSession(posSessionDocId(deviceId, now), {
    deviceId,
    date: startOfLocalDay(new Date(now)),
    shift,
    openedAt: now,
    status: "open",
    saleCount: 0,
    totalSales: 0,
  });
  storePosSessionId(deviceId, session.id);
  writeLocalOpenPosSession(deviceId, session);
  return session;
}

/** ส่งรอบขายขึ้น Firestore เบื้องหลัง (ไม่บล็อก UI) */
export async function persistOpenPosSession(session: PosSession): Promise<void> {
  const payload = {
    deviceId: session.deviceId,
    date: session.date,
    shift: session.shift,
    openedAt: session.openedAt,
    status: "open" as const,
    saleCount: session.saleCount,
    totalSales: session.totalSales,
    updatedAt: Date.now(),
  };
  await setDoc(sessionRef(session.id), payload, { merge: true });
}

export async function openPosSession(deviceId: string, shift: OtShiftId = getCurrentShiftId()): Promise<PosSession> {
  const session = startPosSessionLocal(deviceId, shift);
  await persistOpenPosSession(session);
  return session;
}

export async function getPosSession(sessionId: string): Promise<PosSession | null> {
  const snap = await getDoc(sessionRef(sessionId));
  if (!snap.exists()) return null;
  return mapSession(snap.id, snap.data() as Record<string, unknown>);
}

export async function getCurrentPosSession(deviceId: string): Promise<PosSession | null> {
  const local = readLocalOpenPosSession(deviceId);
  if (local) return local;

  return fetchRemoteOpenPosSession(deviceId);
}

async function fetchRemoteOpenPosSession(deviceId: string): Promise<PosSession | null> {
  const storedId = readStoredPosSessionId(deviceId);
  if (storedId) {
    try {
      const stored = await getPosSession(storedId);
      if (stored?.status === "open" && stored.deviceId === deviceId) {
        writeLocalOpenPosSession(deviceId, stored);
        return stored;
      }
      if (stored && stored.status !== "open") {
        clearStoredPosSessionId(deviceId);
      }
    } catch {
      /* offline */
    }
  }

  try {
    const open = await findOpenPosSession(deviceId);
    if (open) {
      storePosSessionId(deviceId, open.id);
      writeLocalOpenPosSession(deviceId, open);
      return open;
    }
  } catch {
    /* offline */
  }

  try {
    const legacy = await getPosSession(legacyPosSessionDocId(deviceId));
    if (legacy?.status === "open" && legacy.deviceId === deviceId) {
      storePosSessionId(deviceId, legacy.id);
      writeLocalOpenPosSession(deviceId, legacy);
      return legacy;
    }
  } catch {
    /* offline */
  }
  return null;
}

/** อัปเดตจากเซิร์ฟเวอร์เบื้องหลัง — ไม่บล็อกการเข้างาน */
export async function reconcilePosSessionFromRemote(deviceId: string): Promise<PosSession | null> {
  const pendingClosed = readPendingClosedSession(deviceId);
  if (pendingClosed) {
    void persistClosedPosSession(pendingClosed);
  }

  try {
    const remote = await fetchRemoteOpenPosSession(deviceId);
    if (remote) {
      // ปิดบนเครื่องแล้วแต่เซิร์ฟยัง open — อย่าเปิดรอบกลับ
      if (pendingClosed && pendingClosed.id === remote.id) {
        void persistClosedPosSession(pendingClosed);
        return null;
      }
      storePosSessionId(deviceId, remote.id);
      writeLocalOpenPosSession(deviceId, remote);
      return remote;
    }
  } catch {
    /* offline */
  }
  return readLocalOpenPosSession(deviceId);
}

/** นำอัปเดตจาก Firestore มารวมกับ session บนเครื่อง — ไม่ดีดออกเมื่อ doc ยังไม่ขึ้น */
export function applyRemotePosSessionUpdate(
  deviceId: string,
  local: PosSession | null,
  remote: PosSession | null,
): PosSession | null {
  if (!remote) {
    return local?.status === "open" && local.deviceId === deviceId ? local : null;
  }
  if (remote.deviceId !== deviceId) return local;
  if (remote.status === "closed") {
    writeLocalOpenPosSession(deviceId, null);
    clearStoredPosSessionId(deviceId);
    return remote;
  }
  writeLocalOpenPosSession(deviceId, remote);
  storePosSessionId(deviceId, remote.id);
  return remote;
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

export async function closePosSession(sessionId: string, deviceId?: string): Promise<PosSession> {
  const closed = closePosSessionLocal(sessionId, deviceId);
  void persistClosedPosSession(closed);
  return closed;
}

/** ปิดรอบบนเครื่องทันที — ไม่รอเครือข่าย (local-first) */
export function closePosSessionLocal(
  sessionId: string,
  deviceId?: string,
  previous?: PosSession | null,
): PosSession {
  const now = Date.now();
  const base: Record<string, unknown> = previous
    ? {
        deviceId: previous.deviceId,
        date: previous.date,
        shift: previous.shift,
        openedAt: previous.openedAt,
        saleCount: previous.saleCount,
        totalSales: previous.totalSales,
      }
    : { deviceId: deviceId || "" };
  const closed = mapSession(sessionId, {
    ...base,
    status: "closed",
    closedAt: now,
    updatedAt: now,
  });
  if (deviceId) {
    writeLocalOpenPosSession(deviceId, null);
    clearStoredPosSessionId(deviceId);
    writePendingClosedSession(deviceId, closed);
  }
  return closed;
}

/** ส่งสถานะปิดรอบขึ้น Firestore เบื้องหลัง (มี timeout — ไม่ค้าง UI) */
export async function persistClosedPosSession(session: PosSession): Promise<void> {
  const now = session.closedAt || Date.now();
  let data: Record<string, unknown> = {};
  try {
    const snap = await withTimeout(getDoc(sessionRef(session.id)), 4_000, "อ่านรอบหมดเวลา");
    if (snap.exists()) data = snap.data() as Record<string, unknown>;
  } catch {
    /* offline / slow */
  }

  const payload = {
    ...data,
    deviceId: session.deviceId,
    date: session.date,
    shift: session.shift,
    openedAt: session.openedAt,
    saleCount: session.saleCount,
    totalSales: session.totalSales,
    status: "closed" as const,
    closedAt: now,
    updatedAt: Date.now(),
  };

  try {
    await withTimeout(setDoc(sessionRef(session.id), payload, { merge: true }), 5_000, "ปิดรอบหมดเวลา");
    writePendingClosedSession(session.deviceId, null);
  } catch {
    /* คง pending closed ไว้ — boot จะลองซ้ำ */
    writePendingClosedSession(session.deviceId, session);
  }
}

export function formatPosSessionClock(ts: number): string {
  return new Date(ts).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
