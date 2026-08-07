import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";
import { POS_SALES_COL } from "./pos-sales";
import { POS_SESSIONS_COL } from "./pos-session";
import type { PosSale } from "./types";
import { startOfLocalDay } from "./utils";

const BATCH_LIMIT = 400;
const IN_QUERY_LIMIT = 30;

async function commitDeletes(refs: DocumentReference[]): Promise<number> {
  if (!refs.length) return 0;
  const db = getDb();
  let deleted = 0;
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

function salesCol() {
  return collection(getDb(), POS_SALES_COL);
}

function normalizeAdminPaymentMethod(raw: unknown): PosSale["paymentMethod"] {
  const m = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (m === "promptpay") return "promptpay";
  if (m === "transfer" || m === "bank" || m === "bank_transfer") return "transfer";
  return "cash";
}

function mapPosSale(id: string, data: Record<string, unknown>): PosSale {
  const subtotal = typeof data.subtotal === "number" ? data.subtotal : 0;
  const total = typeof data.total === "number" ? data.total : 0;
  let discountBaht = 0;
  if (typeof data.discountBaht === "number" && data.discountBaht > 0) {
    discountBaht = Math.round(data.discountBaht * 100) / 100;
  } else {
    const inferred = Math.round((subtotal - total) * 100) / 100;
    if (inferred > 0.004) discountBaht = inferred;
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
    ...(discountBaht > 0 ? { discountBaht } : {}),
    total,
    paymentMethod: normalizeAdminPaymentMethod(data.paymentMethod),
    cashReceived: typeof data.cashReceived === "number" ? data.cashReceived : 0,
    change: typeof data.change === "number" ? data.change : 0,
    ledgerEntryId: typeof data.ledgerEntryId === "string" ? data.ledgerEntryId : undefined,
    claimToken: typeof data.claimToken === "string" ? data.claimToken : undefined,
    claimTokenExpiresAt:
      typeof data.claimTokenExpiresAt === "number" ? data.claimTokenExpiresAt : undefined,
    claimStatus: typeof data.claimStatus === "string" ? data.claimStatus : undefined,
    claimedAt: typeof data.claimedAt === "number" ? data.claimedAt : undefined,
    claimedByMemberId:
      typeof data.claimedByMemberId === "string" ? data.claimedByMemberId : undefined,
    pointsClaimed: typeof data.pointsClaimed === "number" ? data.pointsClaimed : undefined,
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

export function subscribePosSalesToday(
  onSales: (sales: PosSale[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const today = startOfLocalDay();
  const q = query(
    salesCol(),
    where("date", "==", today),
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

export async function voidPosSale(
  saleId: string,
  actorId: string,
  reason = "",
): Promise<void> {
  const saleRef = doc(getDb(), POS_SALES_COL, saleId);
  const snap = await getDoc(saleRef);
  if (!snap.exists()) throw new Error("ไม่พบบิลนี้");
  const sale = mapPosSale(snap.id, snap.data() as Record<string, unknown>);
  if (sale.status === "voided") throw new Error("บิลนี้ยกเลิกแล้ว");

  const now = Date.now();

  try {
    const batch = writeBatch(getDb());
    batch.update(saleRef, {
      status: "voided",
      voidedAt: now,
      voidedBy: actorId,
      voidReason: reason.trim(),
    });
    await batch.commit();
    await adjustPosSessionTotalsAdmin(sale.sessionId, -sale.total, -1, sale.paymentMethod);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ยกเลิกบิล POS"));
  }
}

async function adjustPosSessionTotalsAdmin(
  sessionId: string,
  totalDelta: number,
  countDelta: number,
  paymentMethod?: "cash" | "promptpay" | "transfer",
): Promise<void> {
  const ref = doc(getDb(), POS_SESSIONS_COL, sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as Record<string, unknown>;
  const saleCount = Math.max(0, (typeof data.saleCount === "number" ? data.saleCount : 0) + countDelta);
  const totalSales = Math.max(
    0,
    Math.round(
      ((typeof data.totalSales === "number" ? data.totalSales : 0) + totalDelta) * 100,
    ) / 100,
  );
  const patch: Record<string, unknown> = { saleCount, totalSales, updatedAt: Date.now() };
  if (paymentMethod === "promptpay") {
    patch.promptpayTotal = Math.max(
      0,
      Math.round(
        ((typeof data.promptpayTotal === "number" ? data.promptpayTotal : 0) + totalDelta) * 100,
      ) / 100,
    );
  } else if (paymentMethod === "transfer") {
    patch.transferTotal = Math.max(
      0,
      Math.round(
        ((typeof data.transferTotal === "number" ? data.transferTotal : 0) + totalDelta) * 100,
      ) / 100,
    );
  } else if (paymentMethod === "cash") {
    patch.cashTotal = Math.max(
      0,
      Math.round(((typeof data.cashTotal === "number" ? data.cashTotal : 0) + totalDelta) * 100) /
        100,
    );
  }
  if (countDelta < 0) {
    patch.voidedCount = Math.max(
      0,
      (typeof data.voidedCount === "number" ? data.voidedCount : 0) + 1,
    );
  }
  await updateDoc(ref, patch);
}

/**
 * Owner: hard-delete selected nPos sales rounds + their bills.
 * Used by BO multi-select on /pos-sales (test/dev cleanup).
 */
export async function deletePosSessionsAdmin(
  sessionIds: string[],
): Promise<{ deletedSessions: number; deletedSales: number }> {
  const ids = [
    ...new Set(
      sessionIds
        .map((id) => String(id || "").trim())
        .filter((id) => id.length > 0),
    ),
  ];
  if (!ids.length) return { deletedSessions: 0, deletedSales: 0 };

  const db = getDb();
  const saleRefs: DocumentReference[] = [];
  try {
    for (let i = 0; i < ids.length; i += IN_QUERY_LIMIT) {
      const chunk = ids.slice(i, i + IN_QUERY_LIMIT);
      const snap = await getDocs(query(salesCol(), where("sessionId", "in", chunk)));
      for (const d of snap.docs) saleRefs.push(d.ref);
    }
    const deletedSales = await commitDeletes(saleRefs);
    const sessionRefs = ids.map((id) => doc(db, POS_SESSIONS_COL, id));
    const deletedSessions = await commitDeletes(sessionRefs);
    return { deletedSessions, deletedSales };
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ลบรอบการขาย nPos"));
  }
}

/**
 * Owner trial close — force-close an open nPos round from BO (not tablet installId).
 * Does not run blind cash count; marks closedAt only so the slim table stays usable.
 */
export async function closePosSessionAdmin(
  sessionId: string,
  actorId: string,
  note = "",
  opts?: { closedByName?: string; closedByEmployeeId?: string },
): Promise<void> {
  const id = (sessionId || "").trim();
  if (!id) throw new Error("ไม่พบรหัสรอบ");
  const ref = doc(getDb(), POS_SESSIONS_COL, id);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("ไม่พบรอบนี้");
    const data = snap.data() as Record<string, unknown>;
    if (data.status === "closed") throw new Error("รอบนี้ปิดแล้ว");
    const now = Date.now();
    const closedByName = String(opts?.closedByName || "").trim().slice(0, 80);
    const closedByEmployeeId = String(opts?.closedByEmployeeId || "")
      .trim()
      .slice(0, 64);
    const patch: Record<string, unknown> = {
      status: "closed",
      closedAt: now,
      updatedAt: now,
      closedBy: actorId || "owner",
      closeSource: "bo-force",
      discrepancyNote: String(note || "ปิดจากหลังร้าน (ทดลอง)").slice(0, 240),
    };
    if (closedByName) patch.closedByName = closedByName;
    if (closedByEmployeeId) patch.closedByEmployeeId = closedByEmployeeId;
    await updateDoc(ref, patch);
  } catch (err) {
    if (err instanceof Error && /ไม่พบ|ปิดแล้ว/.test(err.message)) throw err;
    throw new Error(mapFirestoreError(err, "ปิดรอบจากหลังร้าน"));
  }
}

export function summarizePosSales(sales: PosSale[]) {
  const active = sales.filter((s) => s.status === "completed");
  const voided = sales.filter((s) => s.status === "voided");
  const total = active.reduce((sum, s) => sum + s.total, 0);
  return { activeCount: active.length, voidedCount: voided.length, total };
}
