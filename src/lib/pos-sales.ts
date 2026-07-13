import {
  collection,
  doc,
  runTransaction,
} from "firebase/firestore";
import { getPosDb, getPosFirebaseAuth } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import { allocatePosBillNo } from "./pos-bill";
import { posCreatedBy } from "./pos-menu";
import { bumpPosSessionTotals } from "./pos-session";
import type { PosSaleLine, PosSalePaymentMethod } from "./types";
import { startOfLocalDay } from "./utils";

export const POS_SALES_COL = "posSales";

function ledgerMetaRef() {
  return doc(getPosDb(), "meta", "ledger");
}

function saleDescription(lines: PosSaleLine[]): string {
  const preview = lines
    .slice(0, 2)
    .map((l) => `${l.name}×${l.qty}`)
    .join(", ");
  const more = lines.length > 2 ? ` +${lines.length - 2}` : "";
  return `ขายหน้าร้าน ${preview}${more}`;
}

async function ensureFreshPosToken(): Promise<void> {
  const user = getPosFirebaseAuth().currentUser;
  if (user) await user.getIdToken(true);
}

type LedgerMeta = { balance: number; totalIn: number; totalOut: number };

function readLedgerMeta(data: Record<string, unknown> | undefined): LedgerMeta {
  return {
    balance: typeof data?.balance === "number" ? data.balance : 0,
    totalIn: typeof data?.totalIn === "number" ? data.totalIn : 0,
    totalOut: typeof data?.totalOut === "number" ? data.totalOut : 0,
  };
}

async function commitPosSale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  paymentMethod: PosSalePaymentMethod;
  cashReceived: number;
  change: number;
  total: number;
}): Promise<{ saleId: string; billNo: string }> {
  const now = Date.now();
  const date = startOfLocalDay();
  const createdBy = posCreatedBy(input.deviceId);
  const description = saleDescription(input.lines);
  const billNo = await allocatePosBillNo();

  const db = getPosDb();
  const saleRef = doc(collection(db, POS_SALES_COL));
  const ledgerRef = doc(collection(db, "ledger"));

  const salePayload = {
    billNo,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    date,
    shift: input.shift,
    lines: input.lines,
    subtotal: input.total,
    total: input.total,
    paymentMethod: input.paymentMethod,
    cashReceived: input.cashReceived,
    change: input.change,
    ledgerEntryId: ledgerRef.id,
    createdAt: now,
    createdBy,
    status: "completed" as const,
  };

  const ledgerPayload = {
    date,
    description,
    amountIn: input.total,
    amountOut: 0,
    type: "pos",
    createdBy,
    createdAt: now,
    updatedAt: now,
    receiptUrl: "",
    posSaleId: saleRef.id,
    posDeviceId: input.deviceId,
  };

  await runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(ledgerMetaRef());
    const meta = readLedgerMeta(metaSnap.data() as Record<string, unknown> | undefined);
    const nextBalance = Math.round((meta.balance + input.total) * 100) / 100;
    const nextTotalIn = Math.round((meta.totalIn + input.total) * 100) / 100;

    tx.set(saleRef, salePayload);
    tx.set(ledgerRef, ledgerPayload);
    tx.set(
      ledgerMetaRef(),
      {
        balance: nextBalance,
        totalIn: nextTotalIn,
        totalOut: meta.totalOut,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  await bumpPosSessionTotals(input.sessionId, input.total);
  return { saleId: saleRef.id, billNo };
}

export async function completeCashSale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  cashReceived: number;
}): Promise<{ saleId: string; billNo: string; change: number; total: number }> {
  if (!input.lines.length) {
    throw new Error("ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  const subtotal = input.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const total = Math.round(subtotal * 100) / 100;
  const cashReceived = Math.round(Number(input.cashReceived) * 100) / 100;

  if (cashReceived < total) {
    throw new Error("เงินที่รับน้อยกว่ายอดขาย");
  }

  const change = Math.round((cashReceived - total) * 100) / 100;

  try {
    await ensureFreshPosToken();
    const result = await commitPosSale({
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      shift: input.shift,
      lines: input.lines,
      paymentMethod: "cash",
      cashReceived,
      change,
      total,
    });
    return { ...result, change, total };
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกการขาย"));
  }
}

export async function completePromptPaySale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
}): Promise<{ saleId: string; billNo: string; total: number }> {
  if (!input.lines.length) {
    throw new Error("ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  const subtotal = input.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const total = Math.round(subtotal * 100) / 100;

  try {
    await ensureFreshPosToken();
    const result = await commitPosSale({
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      shift: input.shift,
      lines: input.lines,
      paymentMethod: "promptpay",
      cashReceived: 0,
      change: 0,
      total,
    });
    return { ...result, total };
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกการขาย PromptPay"));
  }
}
