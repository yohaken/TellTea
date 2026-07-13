import {
  collection,
  doc,
  increment,
  writeBatch,
} from "firebase/firestore";
import { getPosDb } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import { posCreatedBy } from "./pos-menu";
import { bumpPosSessionTotals } from "./pos-session";
import type { PosSaleLine } from "./types";
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

export async function completeCashSale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  cashReceived: number;
}): Promise<{ saleId: string; change: number; total: number }> {
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
  const now = Date.now();
  const date = startOfLocalDay();
  const createdBy = posCreatedBy(input.deviceId);
  const description = saleDescription(input.lines);

  const db = getPosDb();
  const saleRef = doc(collection(db, POS_SALES_COL));
  const ledgerRef = doc(collection(db, "ledger"));

  const salePayload = {
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    date,
    shift: input.shift,
    lines: input.lines,
    subtotal: total,
    total,
    paymentMethod: "cash" as const,
    cashReceived,
    change,
    ledgerEntryId: ledgerRef.id,
    createdAt: now,
    createdBy,
    status: "completed" as const,
  };

  const ledgerPayload = {
    date,
    description,
    amountIn: total,
    amountOut: 0,
    type: "pos",
    createdBy,
    createdAt: now,
    updatedAt: now,
    receiptUrl: "",
    posSaleId: saleRef.id,
    posDeviceId: input.deviceId,
  };

  try {
    const batch = writeBatch(db);
    batch.set(saleRef, salePayload);
    batch.set(ledgerRef, ledgerPayload);
    batch.set(
      ledgerMetaRef(),
      {
        balance: increment(total),
        totalIn: increment(total),
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();
    await bumpPosSessionTotals(input.sessionId, total);
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกการขาย"));
  }

  return { saleId: saleRef.id, change, total };
}
