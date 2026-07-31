/**
 * สรุปพูลโบนัสรายเดือน — ให้พนักงานคำนวณส่วนแบ่งขายได้โดยไม่ต้องอ่าน OT/ผลิตทั้งร้าน
 * เขียนโดยเจ้าของ / payrollPay ตอนเปิดหน้าจ่าย · อ่านได้ทุกคนที่มีสิทธิ์ bonus
 */
import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { getDb } from "./firebase";

export type BonusLivePool = {
  periodMonth: string;
  totalSalesPool: number;
  totalProdQty: number;
  employeeCount: number;
  shopDeductPct: number;
  updatedAt: number;
};

function poolRef(periodMonth: string) {
  return doc(getDb(), "bonusLivePool", periodMonth);
}

export async function getBonusLivePool(periodMonth: string): Promise<BonusLivePool | null> {
  const snap = await getDoc(poolRef(periodMonth));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    periodMonth,
    totalSalesPool: Number(d.totalSalesPool) || 0,
    totalProdQty: Number(d.totalProdQty) || 0,
    employeeCount: Number(d.employeeCount) || 0,
    shopDeductPct: Number(d.shopDeductPct) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  };
}

export async function saveBonusLivePool(
  periodMonth: string,
  input: Omit<BonusLivePool, "periodMonth" | "updatedAt">,
): Promise<void> {
  await setDoc(
    poolRef(periodMonth),
    {
      periodMonth,
      totalSalesPool: Number(input.totalSalesPool) || 0,
      totalProdQty: Number(input.totalProdQty) || 0,
      employeeCount: Number(input.employeeCount) || 0,
      shopDeductPct: Number(input.shopDeductPct) || 0,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export function subscribeBonusLivePool(
  periodMonth: string,
  onData: (pool: BonusLivePool | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    poolRef(periodMonth),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        periodMonth,
        totalSalesPool: Number(d.totalSalesPool) || 0,
        totalProdQty: Number(d.totalProdQty) || 0,
        employeeCount: Number(d.employeeCount) || 0,
        shopDeductPct: Number(d.shopDeductPct) || 0,
        updatedAt: Number(d.updatedAt) || 0,
      });
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}
