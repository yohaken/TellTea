import { getPosFirebaseAuth } from "./pos-firebase";
import { addOutboxEntry } from "./pos-outbox";
import { refreshPosSyncSnapshot, runPosSyncFlush, stagePendingSale } from "./pos-sync";
import type { PosSaleLine } from "./types";
import type { PosOutboxEntry, PosSaleMutationPayload, PosSaleResult } from "./pos-sync-types";
import { createPosMutationId, formatPendingBillNo } from "./pos-sync-utils";

export const POS_SALES_COL = "posSales";

function buildMutationPayload(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  paymentMethod: "cash" | "promptpay";
  cashReceived: number;
  clientMutationId: string;
  discountBaht?: number;
}): PosSaleMutationPayload {
  const discountBaht =
    input.discountBaht != null && input.discountBaht > 0
      ? Math.round(input.discountBaht * 100) / 100
      : 0;
  return {
    clientMutationId: input.clientMutationId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    shift: input.shift,
    lines: input.lines,
    paymentMethod: input.paymentMethod,
    cashReceived: input.cashReceived,
    ...(discountBaht > 0 ? { discountBaht } : {}),
  };
}

function optimisticSaleResult(
  payload: PosSaleMutationPayload,
  total: number,
  change: number,
): PosSaleResult {
  return {
    saleId: `local:${payload.clientMutationId}`,
    billNo: formatPendingBillNo(payload.clientMutationId),
    change,
    total,
    pending: true,
    clientMutationId: payload.clientMutationId,
  };
}

function persistSaleInBackground(entry: PosOutboxEntry): void {
  void (async () => {
    try {
      await addOutboxEntry(entry);
      void refreshPosSyncSnapshot();
      void runPosSyncFlush();
    } catch {
      /* PosSyncWatcher retries; sale already shown on screen */
    }
  })();
}

/** Instant local sale — returns before IndexedDB/network; sync runs in background. */
function recordSaleInstant(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  paymentMethod: "cash" | "promptpay";
  cashReceived: number;
  discountBaht?: number;
}): PosSaleResult {
  const authUid = getPosFirebaseAuth().currentUser?.uid || input.deviceId;
  const clientMutationId = createPosMutationId(authUid);
  const payload = buildMutationPayload({ ...input, deviceId: authUid, clientMutationId });

  const subtotal = input.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const discountBaht = Math.min(
    Math.max(0, Math.round(Number(input.discountBaht || 0) * 100) / 100),
    Math.round(subtotal * 100) / 100,
  );
  const total = Math.round((subtotal - discountBaht) * 100) / 100;
  const cashReceived = Math.round(Number(input.cashReceived) * 100) / 100;
  const change =
    input.paymentMethod === "cash"
      ? Math.round((cashReceived - total) * 100) / 100
      : 0;

  const entry: PosOutboxEntry = {
    id: clientMutationId,
    kind: "sale",
    createdAt: Date.now(),
    attempts: 0,
    status: "pending",
    payload,
  };

  stagePendingSale(entry);
  persistSaleInBackground(entry);

  return optimisticSaleResult(payload, total, change);
}

export function completeCashSale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  cashReceived: number;
  discountBaht?: number;
}): PosSaleResult {
  if (!input.lines.length) {
    throw new Error("ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  const subtotal = input.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const discountBaht = Math.min(
    Math.max(0, Math.round(Number(input.discountBaht || 0) * 100) / 100),
    Math.round(subtotal * 100) / 100,
  );
  const total = Math.round((subtotal - discountBaht) * 100) / 100;
  const cashReceived = Math.round(Number(input.cashReceived) * 100) / 100;

  if (cashReceived < total) {
    throw new Error("เงินที่รับน้อยกว่ายอดขาย");
  }

  return recordSaleInstant({
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    shift: input.shift,
    lines: input.lines,
    paymentMethod: "cash",
    cashReceived,
    discountBaht,
  });
}

export function completePromptPaySale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  discountBaht?: number;
}): PosSaleResult {
  if (!input.lines.length) {
    throw new Error("ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  return recordSaleInstant({
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    shift: input.shift,
    lines: input.lines,
    paymentMethod: "promptpay",
    cashReceived: 0,
    discountBaht: input.discountBaht,
  });
}
