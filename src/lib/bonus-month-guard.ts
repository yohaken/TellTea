/**
 * Guard: closed bonus months block ชง/ผลิต create & qty edits.
 * Kept free of production/ot imports to avoid circular deps.
 */
import {
  doc,
  getDoc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { bangkokCalendarParts } from "./task-weekly-logic";

export const BONUS_MONTH_CLOSE_COL = "bonusMonthCloses";

export type BonusMonthCloseSnapshotRow = {
  workerId: string;
  workerName: string;
  salesShare: number;
  prodBonus: number;
  otMain: number;
  total: number;
  deductPct: number;
  deductAmount: number;
  remaining: number;
  workedThisMonth: boolean;
};

export type BonusMonthCloseDoc = {
  month: string;
  status: "closed";
  closedAt: number;
  closedBy: string;
  snapshot: {
    employeeCount: number;
    totalProdQty: number;
    totalSalesPool: number;
    shopDeductPct: number;
    totalDeducted: number;
    totalRemaining: number;
    rows: BonusMonthCloseSnapshotRow[];
  };
  lockedProd: number;
  lockedOt: number;
};

/** YYYY-MM from Asia/Bangkok calendar date. */
export function periodMonthFromDateMs(ms: number): string {
  const { y, m } = bangkokCalendarParts(ms);
  return `${y}-${String(m).padStart(2, "0")}`;
}

function closeRef(month: string) {
  return doc(getDb(), BONUS_MONTH_CLOSE_COL, month);
}

export async function getBonusMonthClose(
  month: string,
): Promise<BonusMonthCloseDoc | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("เดือนไม่ถูกต้อง");
  const snap = await getDoc(closeRef(month));
  if (!snap.exists()) return null;
  return snap.data() as BonusMonthCloseDoc;
}

export function subscribeBonusMonthClose(
  month: string,
  onData: (doc: BonusMonthCloseDoc | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    onData(null);
    return () => undefined;
  }
  return onSnapshot(
    closeRef(month),
    (snap) => {
      onData(snap.exists() ? (snap.data() as BonusMonthCloseDoc) : null);
    },
    (err) => onError?.(err),
  );
}

export async function isBonusMonthClosed(month: string): Promise<boolean> {
  // พนักงานอ่าน bonusMonthCloses ไม่ได้ — ใช้ bonusMonthStatus (ไม่มียอดรายคน)
  try {
    const { getBonusMonthStatus } = await import("./bonus-personal-close");
    const status = await getBonusMonthStatus(month);
    if (status?.status === "closed") return true;
  } catch {
    /* fall through */
  }
  try {
    const docData = await getBonusMonthClose(month);
    return !!docData && docData.status === "closed";
  } catch {
    return false;
  }
}

/** Block create/edit when the entry date falls in a closed bonus month. */
export async function assertBonusMonthOpenForDate(dateMs: number): Promise<void> {
  if (!dateMs) return;
  const month = periodMonthFromDateMs(dateMs);
  if (await isBonusMonthClosed(month)) {
    throw new Error(`เดือน ${month} ปิดโบนัสแล้ว — ลง/แก้ชง·ผลิตย้อนหลังไม่ได้`);
  }
}
