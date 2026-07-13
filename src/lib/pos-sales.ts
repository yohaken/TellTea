import { getPosFirebaseAuth } from "./pos-firebase";
import { addOutboxEntry, getOutboxEntry } from "./pos-outbox";
import { refreshPosSyncSnapshot, runPosSyncFlush } from "./pos-sync";
import type { PosSaleLine } from "./types";
import type { PosSaleMutationPayload, PosSaleResult } from "./pos-sync-types";
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
}): PosSaleMutationPayload {
  return {
    clientMutationId: input.clientMutationId,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    shift: input.shift,
    lines: input.lines,
    paymentMethod: input.paymentMethod,
    cashReceived: input.cashReceived,
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

async function enqueueSale(payload: PosSaleMutationPayload, total: number, change: number): Promise<PosSaleResult> {
  const existing = await getOutboxEntry(payload.clientMutationId);
  if (!existing) {
    await addOutboxEntry({
      id: payload.clientMutationId,
      kind: "sale",
      createdAt: Date.now(),
      attempts: 0,
      status: "pending",
      payload,
    });
  }
  await refreshPosSyncSnapshot();
  void runPosSyncFlush();
  return optimisticSaleResult(payload, total, change);
}

async function completeSale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  paymentMethod: "cash" | "promptpay";
  cashReceived: number;
}): Promise<PosSaleResult> {
  const authUid = getPosFirebaseAuth().currentUser?.uid || input.deviceId;
  const clientMutationId = createPosMutationId(authUid);
  const payload = buildMutationPayload({ ...input, deviceId: authUid, clientMutationId });

  const subtotal = input.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const total = Math.round(subtotal * 100) / 100;
  const cashReceived = Math.round(Number(input.cashReceived) * 100) / 100;
  const change =
    input.paymentMethod === "cash"
      ? Math.round((cashReceived - total) * 100) / 100
      : 0;

  return enqueueSale(payload, total, change);
}

export async function completeCashSale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  cashReceived: number;
}): Promise<PosSaleResult> {
  if (!input.lines.length) {
    throw new Error("ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  const subtotal = input.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const total = Math.round(subtotal * 100) / 100;
  const cashReceived = Math.round(Number(input.cashReceived) * 100) / 100;

  if (cashReceived < total) {
    throw new Error("เงินที่รับน้อยกว่ายอดขาย");
  }

  return completeSale({
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    shift: input.shift,
    lines: input.lines,
    paymentMethod: "cash",
    cashReceived,
  });
}

export async function completePromptPaySale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
}): Promise<PosSaleResult> {
  if (!input.lines.length) {
    throw new Error("ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  return completeSale({
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    shift: input.shift,
    lines: input.lines,
    paymentMethod: "promptpay",
    cashReceived: 0,
  });
}
