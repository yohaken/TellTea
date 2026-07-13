import { getPosFirebaseAuth } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import { addOutboxEntry, getOutboxEntry } from "./pos-outbox";
import { invokePosCompleteSale, mapCfResultToSaleResult, refreshPosSyncSnapshot } from "./pos-sync";
import type { PosSaleLine } from "./types";
import type { PosSaleMutationPayload, PosSaleResult } from "./pos-sync-types";
import {
  createPosMutationId,
  formatPendingBillNo,
  isBrowserOnline,
  isRetryableSaleError,
} from "./pos-sync-utils";

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
      payload,
    });
  }
  await refreshPosSyncSnapshot();
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

  if (!isBrowserOnline()) {
    return enqueueSale(payload, total, change);
  }

  try {
    const data = await invokePosCompleteSale(payload);
    return mapCfResultToSaleResult(data, false);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = (err as Error)?.message || "";
    if (code === "functions/permission-denied") {
      throw new Error("บันทึกการขาย — ไม่ใช่เครื่อง POS ลองรีเฟรชหน้า");
    }
    if (code === "functions/invalid-argument") {
      throw new Error(message || "ข้อมูลการขายไม่ถูกต้อง");
    }
    if (isRetryableSaleError(err)) {
      return enqueueSale(payload, total, change);
    }
    if (code === "functions/unavailable") {
      throw new Error("บันทึกการขาย — เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่");
    }
    throw new Error(message || mapFirestoreError(err, "บันทึกการขาย", "pos"));
  }
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
