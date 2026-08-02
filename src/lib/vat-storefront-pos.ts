/**
 * เชื่อมยอดหน้าร้านจาก nPOS (posSales) → แถบส่งหน้าร้าน / กล่อง A+D
 * ฐาน = วันบิล Asia/Bangkok · ไม่ใช้รอบกะ
 * เดือน >= 2026-08 default เปิด · ก่อนหน้านั้นปิด (ไม่มีข้อมูล)
 */
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { POS_SALES_COL } from "./pos-sales";
import {
  bangkokDateKey,
  dateKeysInMonth,
  isMonthKey,
  normalizeMoney,
  roundMoney,
  startMsFromDateKey,
} from "./vat-sales";

/** เดือนแรกที่มีข้อมูล nPOS หน้าร้านจริง */
export const SF_POS_CONNECT_FROM_MONTH = "2026-08";

export type PosStorefrontTenderTotals = {
  cash: number;
  /** promptpay + bank transfer */
  transfer: number;
  promptpay: number;
  bankTransfer: number;
  gross: number;
};

export function emptyPosStorefrontTenders(): PosStorefrontTenderTotals {
  return {
    cash: 0,
    transfer: 0,
    promptpay: 0,
    bankTransfer: 0,
    gross: 0,
  };
}

/** default ติ๊กเชื่อม POS ตามเดือน */
export function defaultPosConnectEnabled(monthKey: string): boolean {
  if (!isMonthKey(monthKey)) return false;
  return monthKey >= SF_POS_CONNECT_FROM_MONTH;
}

export function sfPosConnectKey(monthKey: string): string {
  return `telltea.vat.sfPosConnect.${monthKey}`;
}

/** อ่านติ๊ก — ถ้ายังไม่เคยตั้ง ใช้ default ตามเดือน */
export function loadSfPosConnect(monthKey: string): boolean {
  if (typeof window === "undefined") return defaultPosConnectEnabled(monthKey);
  try {
    const raw = window.localStorage.getItem(sfPosConnectKey(monthKey));
    if (raw == null || raw === "") return defaultPosConnectEnabled(monthKey);
    return raw === "1" || raw === "true";
  } catch {
    return defaultPosConnectEnabled(monthKey);
  }
}

export function saveSfPosConnect(monthKey: string, on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sfPosConnectKey(monthKey), on ? "1" : "0");
  } catch {
    /* quota / private */
  }
}

export type SfSendTenders = { cash: number; transfer: number };

/** คูณ % ส่งเข้าตาราง — แยกสด/โอน */
export function scaleSfSendTenders(
  tenders: SfSendTenders,
  pct: number,
): SfSendTenders {
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 100;
  const scale = (n: number) =>
    Math.round(((normalizeMoney(n) * p) / 100) * 100) / 100;
  return {
    cash: scale(tenders.cash),
    transfer: scale(tenders.transfer),
  };
}

export function sfSendTendersGross(t: SfSendTenders): number {
  return normalizeMoney(
    normalizeMoney(t.cash) + normalizeMoney(t.transfer),
  );
}

function normalizePosPayment(raw: unknown): "cash" | "promptpay" | "transfer" {
  const m = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (m === "promptpay") return "promptpay";
  if (m === "transfer" || m === "bank" || m === "bank_transfer") return "transfer";
  return "cash";
}

/**
 * รวมยอดหน้าร้านจาก posSales ตามวันบิล Bangkok
 * แยกสด / พร้อมเพย์ / โอน · ไม่นับ void · ไม่ใช้รอบกะ
 */
export async function fetchPosStorefrontTenderTotalsByMonth(
  monthKey: string,
): Promise<PosStorefrontTenderTotals> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const keys = dateKeysInMonth(monthKey);
  const start = startMsFromDateKey(keys[0]);
  const end = startMsFromDateKey(keys[keys.length - 1]);
  const legacyStart = start + 7 * 60 * 60 * 1000;
  const legacyEnd = end + 7 * 60 * 60 * 1000;

  const keySet = new Set(keys);
  const seen = new Set<string>();
  let cash = 0;
  let promptpay = 0;
  let bankTransfer = 0;

  const addSnap = async (startMs: number, endMs: number) => {
    const snap = await getDocs(
      query(
        collection(getDb(), POS_SALES_COL),
        where("date", ">=", startMs),
        where("date", "<=", endMs),
      ),
    );
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() as Record<string, unknown>;
      if (data.status === "voided") continue;
      const dateMs = typeof data.date === "number" ? data.date : 0;
      if (!dateMs) continue;
      const dateKey = bangkokDateKey(dateMs);
      if (!keySet.has(dateKey)) continue;
      const total = normalizeMoney(
        typeof data.total === "number" ? data.total : 0,
      );
      if (!(total > 0)) continue;
      const pay = normalizePosPayment(data.paymentMethod);
      if (pay === "promptpay") promptpay = roundMoney(promptpay + total);
      else if (pay === "transfer") bankTransfer = roundMoney(bankTransfer + total);
      else cash = roundMoney(cash + total);
    }
  };

  await addSnap(start, end);
  await addSnap(legacyStart, legacyEnd);

  const transfer = roundMoney(promptpay + bankTransfer);
  return {
    cash,
    transfer,
    promptpay,
    bankTransfer,
    gross: roundMoney(cash + transfer),
  };
}
