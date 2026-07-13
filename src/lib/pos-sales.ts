import { httpsCallable } from "firebase/functions";
import { getPosFirebaseAuth, getPosFirebaseFunctions } from "./pos-firebase";
import { mapFirestoreError } from "./firestore-errors";
import type { PosSaleLine, PosSalePaymentMethod } from "./types";

export const POS_SALES_COL = "posSales";

type SaleResult = { saleId: string; billNo: string; change: number; total: number };

type PosCompleteSaleInput = {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  paymentMethod: PosSalePaymentMethod;
  cashReceived: number;
};

async function ensureFreshPosToken(): Promise<void> {
  const user = getPosFirebaseAuth().currentUser;
  if (user) await user.getIdToken(true);
}

async function callPosCompleteSale(input: PosCompleteSaleInput): Promise<SaleResult> {
  await ensureFreshPosToken();
  const authUid = getPosFirebaseAuth().currentUser?.uid;
  const deviceId = authUid || input.deviceId;
  const posCompleteSale = httpsCallable<PosCompleteSaleInput, SaleResult>(
    getPosFirebaseFunctions(),
    "posCompleteSale",
  );
  const result = await posCompleteSale({ ...input, deviceId });
  const data = result.data;
  if (!data?.saleId || !data?.billNo) {
    throw new Error("บันทึกการขาย — ตอบกลับไม่สมบูรณ์");
  }
  return data;
}

export async function completeCashSale(input: {
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  cashReceived: number;
}): Promise<SaleResult> {
  if (!input.lines.length) {
    throw new Error("ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  const subtotal = input.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const total = Math.round(subtotal * 100) / 100;
  const cashReceived = Math.round(Number(input.cashReceived) * 100) / 100;

  if (cashReceived < total) {
    throw new Error("เงินที่รับน้อยกว่ายอดขาย");
  }

  try {
    return await callPosCompleteSale({
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      shift: input.shift,
      lines: input.lines,
      paymentMethod: "cash",
      cashReceived,
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = (err as Error)?.message || "";
    if (code === "functions/permission-denied") {
      throw new Error("บันทึกการขาย — ไม่ใช่เครื่อง POS ลองรีเฟรชหน้า");
    }
    if (code === "functions/invalid-argument") {
      throw new Error(message || "ข้อมูลการขายไม่ถูกต้อง");
    }
    if (code === "functions/unavailable" || code === "functions/internal") {
      throw new Error(mapFirestoreError(err, "บันทึกการขาย", "pos"));
    }
    throw new Error(mapFirestoreError(err, "บันทึกการขาย", "pos"));
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

  try {
    const result = await callPosCompleteSale({
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      shift: input.shift,
      lines: input.lines,
      paymentMethod: "promptpay",
      cashReceived: 0,
    });
    return { saleId: result.saleId, billNo: result.billNo, total: result.total };
  } catch (err) {
    throw new Error(mapFirestoreError(err, "บันทึกการขาย PromptPay", "pos"));
  }
}
