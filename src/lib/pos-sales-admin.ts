import {
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { mapFirestoreError } from "./firestore-errors";
import { POS_SALES_COL } from "./pos-sales";
import { POS_SESSIONS_COL } from "./pos-session";
import type { PosSale } from "./types";
import { startOfLocalDay } from "./utils";

function salesCol() {
  return collection(getDb(), POS_SALES_COL);
}

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
    paymentMethod: "cash",
    cashReceived: typeof data.cashReceived === "number" ? data.cashReceived : 0,
    change: typeof data.change === "number" ? data.change : 0,
    ledgerEntryId: typeof data.ledgerEntryId === "string" ? data.ledgerEntryId : "",
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
  const voidLedgerRef = doc(collection(getDb(), "ledger"));
  const voidLedgerPayload = {
    date: sale.date,
    description: `ยกเลิก POS ${sale.billNo}${reason ? ` — ${reason.trim()}` : ""}`,
    amountIn: 0,
    amountOut: sale.total,
    type: "pos_void",
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
    receiptUrl: "",
    posSaleId: sale.id,
    posDeviceId: sale.deviceId,
  };

  try {
    const batch = writeBatch(getDb());
    batch.update(saleRef, {
      status: "voided",
      voidedAt: now,
      voidedBy: actorId,
      voidReason: reason.trim(),
      voidLedgerEntryId: voidLedgerRef.id,
    });
    batch.set(voidLedgerRef, voidLedgerPayload);
    batch.set(
      doc(getDb(), "meta", "ledger"),
      {
        balance: increment(-sale.total),
        totalOut: increment(sale.total),
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();
    await adjustPosSessionTotalsAdmin(sale.sessionId, -sale.total, -1);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "ยกเลิกบิล POS"));
  }
}

async function adjustPosSessionTotalsAdmin(
  sessionId: string,
  totalDelta: number,
  countDelta: number,
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
  await updateDoc(ref, { saleCount, totalSales, updatedAt: Date.now() });
}

export function summarizePosSales(sales: PosSale[]) {
  const active = sales.filter((s) => s.status === "completed");
  const voided = sales.filter((s) => s.status === "voided");
  const total = active.reduce((sum, s) => sum + s.total, 0);
  return { activeCount: active.length, voidedCount: voided.length, total };
}
