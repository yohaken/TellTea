import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "./firebase";
import type { CashFillSource, CashSlipKind } from "./cash-deposits";

export type ExtractCashBankResult = {
  mode: "bank";
  transferDate: string;
  bankAmount: number | null;
  transferFee: number;
  bankRef: string;
  reason: string;
  model: string;
  source: "ai";
  usedImages: number;
};

export type ExtractCashDayResult = {
  mode: "day";
  date: string;
  cashAmount: number | null;
  drawerCloseAmount: number | null;
  slipKind: CashSlipKind;
  shiftLabel: string;
  reason: string;
  model: string;
  source: "ai";
  usedImages: number;
};

function normalizeSlipKind(raw: string): CashSlipKind {
  if (raw === "daily" || raw === "shift" || raw === "unknown") return raw;
  return "unknown";
}

/** อ่านสลิปโอนธนาคาร (1–2 รูป) → ยอดโอน / ค่าธรรมเนียม / อ้างอิง */
export async function extractCashBankSlipFromPhotos(
  imageRefs: string[],
  opts?: { model?: string },
): Promise<ExtractCashBankResult> {
  const refs = imageRefs.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 2);
  if (!refs.length) throw new Error("ต้องมีรูปสลิปโอนอย่างน้อย 1 รูป");

  const fn = httpsCallable<
    { mode: "bank"; imageRefs: string[]; model?: string },
    ExtractCashBankResult
  >(getFirebaseFunctions(), "extractCashDepositSlip");

  const result = await fn({
    mode: "bank",
    imageRefs: refs,
    ...(opts?.model ? { model: opts.model } : {}),
  });
  const data = result.data;
  const bankAmount = Number(data?.bankAmount);
  const fee = Number(data?.transferFee);
  return {
    mode: "bank",
    transferDate: String(data?.transferDate || "").trim(),
    bankAmount: Number.isFinite(bankAmount) && bankAmount > 0 ? bankAmount : null,
    transferFee: Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) / 100 : 0,
    bankRef: String(data?.bankRef || "").trim(),
    reason: String(data?.reason || "").trim(),
    model: String(data?.model || ""),
    source: "ai",
    usedImages: Number(data?.usedImages) || 0,
  };
}

/** อ่านสลิปสรุป POS → ยอดขายเงินสด (Payment→Cash) / วันที่ — ไม่ใช้ยอดลิ้นชัก */
export async function extractCashDaySlipFromPhotos(
  imageRefs: string[],
  opts?: { model?: string },
): Promise<ExtractCashDayResult> {
  const refs = imageRefs.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 2);
  if (!refs.length) throw new Error("ต้องมีรูปสลิป POS อย่างน้อย 1 รูป");

  const fn = httpsCallable<
    { mode: "day"; imageRefs: string[]; model?: string },
    ExtractCashDayResult
  >(getFirebaseFunctions(), "extractCashDepositSlip");

  const result = await fn({
    mode: "day",
    imageRefs: refs,
    ...(opts?.model ? { model: opts.model } : {}),
  });
  const data = result.data;
  const cashAmount = Number(data?.cashAmount);
  const drawer = Number(data?.drawerCloseAmount);
  return {
    mode: "day",
    date: String(data?.date || "").trim(),
    cashAmount: Number.isFinite(cashAmount) && cashAmount > 0 ? cashAmount : null,
    drawerCloseAmount: Number.isFinite(drawer) && drawer > 0 ? drawer : null,
    slipKind: normalizeSlipKind(String(data?.slipKind || "unknown")),
    shiftLabel: String(data?.shiftLabel || "").trim(),
    reason: String(data?.reason || "").trim(),
    model: String(data?.model || ""),
    source: "ai",
    usedImages: Number(data?.usedImages) || 0,
  };
}

export function labelCashFillSource(source: CashFillSource | undefined) {
  if (source === "ai") return "AI";
  if (source === "staff") return "พนักงาน";
  return "";
}
