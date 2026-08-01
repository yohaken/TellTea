/**
 * R1–R3: per-round cash remittance handoff + manual rounds + cash-in fill.
 * Formula: remitAmount = max(0, counted − leaveFloat) — locked in Z slip.
 */
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";
import { POS_SESSIONS_COL } from "./pos-session";
import type { PosSession } from "./types";
import { startOfLocalDay } from "./utils";

export type PosRemitStatus = "pending" | "handed" | "mismatch";

export const MANUAL_POS_DEVICE_ID = "manual";

export type RemitHandoffInput = {
  handedAmount: number;
  handedByName?: string;
  receivedByName?: string;
  note?: string;
  actorId: string;
};

export type ManualPosSessionInput = {
  actorId: string;
  /** Counter / station label (shown as device) */
  label: string;
  /** Local midnight of sales day */
  date: number;
  openingCash?: number;
  cashTotal?: number;
  closingCashCounted?: number;
  leaveFloat?: number;
  /** If omitted: max(0, counted − leaveFloat) when both present */
  remitAmount?: number;
  openedByName?: string;
  note?: string;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Effective remit for a session (stored or counted − leave). */
export function sessionRemitAmount(session: Pick<
  PosSession,
  "remitAmount" | "closingCashCounted" | "leaveFloat"
>): number | undefined {
  if (session.remitAmount != null && Number.isFinite(session.remitAmount)) {
    return roundMoney(Math.max(0, session.remitAmount));
  }
  const counted = session.closingCashCounted;
  const leave = session.leaveFloat;
  if (counted != null && leave != null && Number.isFinite(counted) && Number.isFinite(leave)) {
    return roundMoney(Math.max(0, counted - leave));
  }
  return undefined;
}

/**
 * Closed round with a known remit → pending until handoff recorded.
 * Open / no remit → undefined (show —).
 */
export function deriveRemitStatus(
  session: Pick<PosSession, "status" | "remitStatus" | "remitAmount" | "closingCashCounted" | "leaveFloat">,
): PosRemitStatus | undefined {
  if (session.status !== "closed") return undefined;
  const raw = session.remitStatus;
  if (raw === "handed" || raw === "mismatch" || raw === "pending") return raw;
  const remit = sessionRemitAmount(session);
  if (remit == null) return undefined;
  return "pending";
}

export function labelRemitStatus(status: PosRemitStatus | undefined): string {
  switch (status) {
    case "handed":
      return "ส่งแล้ว";
    case "mismatch":
      return "ไม่ตรง";
    case "pending":
      return "ค้าง";
    default:
      return "—";
  }
}

export function remitHandoffVariance(expected: number, handed: number): number {
  return roundMoney((Number(handed) || 0) - (Number(expected) || 0));
}

export function resolveRemitStatusFromAmounts(
  expected: number,
  handed: number,
): Exclude<PosRemitStatus, "pending"> {
  return Math.abs(remitHandoffVariance(expected, handed)) < 0.005 ? "handed" : "mismatch";
}

export function buildRemitHandoffPatch(
  session: Pick<PosSession, "status" | "remitAmount" | "closingCashCounted" | "leaveFloat">,
  input: RemitHandoffInput,
): Record<string, unknown> {
  if (session.status !== "closed") throw new Error("บันทึกส่งเงินได้เฉพาะรอบที่ปิดแล้ว");
  const expected = sessionRemitAmount(session);
  if (expected == null) throw new Error("รอบนี้ยังไม่มียอดนำส่ง — ใส่ยอดนับ/ทอนค้างก่อน");
  const handed = roundMoney(Math.max(0, Number(input.handedAmount) || 0));
  if (!(handed >= 0) || !Number.isFinite(handed)) throw new Error("ยอดที่รับจริงไม่ถูกต้อง");
  const status = resolveRemitStatusFromAmounts(expected, handed);
  const now = Date.now();
  return {
    remitStatus: status,
    remitHandedAmount: handed,
    remitHandedAt: now,
    remitHandedByName: String(input.handedByName || "").trim().slice(0, 80),
    remitReceivedByName: String(input.receivedByName || "").trim().slice(0, 80),
    remitHandoffNote: String(input.note || "").trim().slice(0, 240),
    remitHandedBy: String(input.actorId || "").trim().slice(0, 120),
    updatedAt: now,
  };
}

export function buildClearRemitHandoffPatch(): Record<string, unknown> {
  return {
    remitStatus: "pending",
    remitHandedAmount: 0,
    remitHandedAt: 0,
    remitHandedByName: "",
    remitReceivedByName: "",
    remitHandoffNote: "",
    remitHandedBy: "",
    updatedAt: Date.now(),
  };
}

export async function recordPosSessionRemitHandoff(
  sessionId: string,
  session: Pick<PosSession, "status" | "remitAmount" | "closingCashCounted" | "leaveFloat">,
  input: RemitHandoffInput,
): Promise<void> {
  const id = String(sessionId || "").trim();
  if (!id) throw new Error("ไม่พบรหัสรอบ");
  try {
    await updateDoc(doc(getDb(), POS_SESSIONS_COL, id), buildRemitHandoffPatch(session, input));
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกส่งเงินรอบ"));
  }
}

export async function clearPosSessionRemitHandoff(sessionId: string): Promise<void> {
  const id = String(sessionId || "").trim();
  if (!id) throw new Error("ไม่พบรหัสรอบ");
  try {
    await updateDoc(doc(getDb(), POS_SESSIONS_COL, id), buildClearRemitHandoffPatch());
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ล้างสถานะส่งเงิน"));
  }
}

export function newManualPosSessionId(now = Date.now()): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `manual_${now}_${rand}`;
}

export function buildManualPosSessionDoc(
  input: ManualPosSessionInput,
  now = Date.now(),
): { id: string; data: Record<string, unknown> } {
  const label = String(input.label || "").trim().slice(0, 80);
  if (!label) throw new Error("ต้องใส่ชื่อเคาน์เตอร์/รอบ");
  const actorId = String(input.actorId || "").trim();
  if (!actorId) throw new Error("ไม่พบผู้บันทึก");
  const date = startOfLocalDay(new Date(input.date || now));
  if (!date) throw new Error("วันที่ไม่ถูกต้อง");

  const openingCash =
    input.openingCash != null && Number.isFinite(input.openingCash)
      ? roundMoney(Math.max(0, input.openingCash))
      : undefined;
  const cashTotal =
    input.cashTotal != null && Number.isFinite(input.cashTotal)
      ? roundMoney(Math.max(0, input.cashTotal))
      : undefined;
  const counted =
    input.closingCashCounted != null && Number.isFinite(input.closingCashCounted)
      ? roundMoney(Math.max(0, input.closingCashCounted))
      : undefined;
  const leave =
    input.leaveFloat != null && Number.isFinite(input.leaveFloat)
      ? roundMoney(Math.max(0, input.leaveFloat))
      : undefined;

  let remit =
    input.remitAmount != null && Number.isFinite(input.remitAmount)
      ? roundMoney(Math.max(0, input.remitAmount))
      : undefined;
  if (remit == null && counted != null && leave != null) {
    remit = roundMoney(Math.max(0, counted - leave));
  }
  if (remit == null) throw new Error("ต้องมียอดนำส่ง หรือ นับ + ทอนค้าง");

  const openedByName = String(input.openedByName || "").trim().slice(0, 80);
  const note = String(input.note || "").trim().slice(0, 240);
  const expected =
    openingCash != null && cashTotal != null
      ? roundMoney(openingCash + cashTotal)
      : counted;
  const diff =
    counted != null && expected != null ? roundMoney(counted - expected) : undefined;

  const id = newManualPosSessionId(now);
  const data: Record<string, unknown> = {
    deviceId: MANUAL_POS_DEVICE_ID,
    date,
    shift: "manual",
    openedAt: date + 8 * 60 * 60 * 1000,
    closedAt: now,
    status: "closed",
    saleCount: 0,
    totalSales: cashTotal ?? remit,
    source: "manual",
    counterLabel: label,
    remitAmount: remit,
    remitStatus: "pending",
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
    closeSource: "bo-manual",
  };
  if (openingCash != null) data.openingCash = openingCash;
  if (cashTotal != null) data.cashTotal = cashTotal;
  if (counted != null) data.closingCashCounted = counted;
  if (leave != null) data.leaveFloat = leave;
  if (expected != null) data.expectedCash = expected;
  if (diff != null) data.cashDifference = diff;
  if (openedByName) data.openedByName = openedByName;
  if (note) data.discrepancyNote = note;
  return { id, data };
}

export async function createManualPosSession(input: ManualPosSessionInput): Promise<string> {
  try {
    const { id, data } = buildManualPosSessionDoc(input);
    await setDoc(doc(getDb(), POS_SESSIONS_COL, id), data);
    return id;
  } catch (err) {
    if (err instanceof Error && /ต้อง|ไม่พบ|วันที่/.test(err.message)) throw err;
    throw new Error(mapFirestoreError(err, "สร้างรอบมือ"));
  }
}

/** Closed sessions whose sales day matches the cash-deposit day line. */
export function sessionsForCashDepositDay(
  sessions: PosSession[],
  dayMs: number,
): PosSession[] {
  const day = startOfLocalDay(new Date(dayMs || 0));
  if (!day) return [];
  return sessions.filter((s) => {
    if (s.status !== "closed") return false;
    const sDay = startOfLocalDay(new Date(s.date || s.openedAt || 0));
    return sDay === day && sessionRemitAmount(s) != null;
  });
}

export function sumSessionRemits(sessions: PosSession[]): number {
  return roundMoney(
    sessions.reduce((sum, s) => sum + (sessionRemitAmount(s) ?? 0), 0),
  );
}

/** Fill day-line cashAmount from selected session remits (bank reconcile expected). */
export function fillDayCashFromSessions(
  day: { cashAmount: number; cashAmountSource?: string; note?: string; sessionIds?: string[] },
  sessions: PosSession[],
  sessionIds: string[],
): {
  cashAmount: number;
  cashAmountSource: "staff";
  sessionIds: string[];
  note: string;
} {
  const idSet = new Set(sessionIds.map((id) => String(id || "").trim()).filter(Boolean));
  const picked = sessions.filter((s) => idSet.has(s.id));
  const cashAmount = sumSessionRemits(picked);
  const labels = picked
    .map((s) => {
      const code = s.id.includes("_") ? s.id.split("_").pop()?.slice(0, 6) : s.id.slice(-6);
      return code || s.id.slice(-6);
    })
    .filter(Boolean);
  const baseNote = String(day.note || "").replace(/\s*·\s*รอบ:\s*[^·]*$/u, "").trim();
  const note = labels.length
    ? `${baseNote}${baseNote ? " · " : ""}รอบ: ${labels.join(", ")}`.slice(0, 200)
    : baseNote;
  return {
    cashAmount,
    cashAmountSource: "staff",
    sessionIds: picked.map((s) => s.id),
    note,
  };
}
