/**
 * Snapshot โบนัสรายคนหลังปิดเดือน — พนักงานอ่านได้เฉพาะของตัวเอง
 * (bonusMonthCloses ทั้งร้าน = เจ้าของ / payrollPay เท่านั้น)
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import type { WorkerMonthBonus } from "./bonus";
import type { BonusMonthCloseDoc, BonusMonthCloseSnapshotRow } from "./bonus-month-guard";
import { getDb } from "./firebase";

export const BONUS_MONTH_STATUS_COL = "bonusMonthStatus";
export const BONUS_PERSONAL_CLOSE_COL = "bonusPersonalCloses";

export type BonusMonthStatusDoc = {
  month: string;
  status: "closed";
  closedAt: number;
  closedBy: string;
};

export type BonusPersonalCloseDoc = {
  month: string;
  employeeId: string;
  employeeName: string;
  status: "closed";
  closedAt: number;
  shopDeductPct: number;
  row: BonusMonthCloseSnapshotRow;
};

export function personalCloseId(month: string, employeeId: string): string {
  return `${month}_${employeeId}`;
}

function statusRef(month: string) {
  return doc(getDb(), BONUS_MONTH_STATUS_COL, month);
}

function personalRef(month: string, employeeId: string) {
  return doc(getDb(), BONUS_PERSONAL_CLOSE_COL, personalCloseId(month, employeeId));
}

export async function getBonusMonthStatus(
  month: string,
): Promise<BonusMonthStatusDoc | null> {
  const snap = await getDoc(statusRef(month));
  if (!snap.exists()) return null;
  return snap.data() as BonusMonthStatusDoc;
}

export async function getBonusMonthStatusFromServer(
  month: string,
): Promise<BonusMonthStatusDoc | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const snap = await getDocFromServer(statusRef(month));
  if (!snap.exists()) return null;
  return snap.data() as BonusMonthStatusDoc;
}

export async function getBonusPersonalCloseFromServer(
  month: string,
  employeeId: string,
): Promise<BonusPersonalCloseDoc | null> {
  if (!/^\d{4}-\d{2}$/.test(month) || !employeeId.trim()) return null;
  const snap = await getDocFromServer(personalRef(month, employeeId));
  if (!snap.exists()) return null;
  return snap.data() as BonusPersonalCloseDoc;
}

export function subscribeBonusMonthStatus(
  month: string,
  onData: (doc: BonusMonthStatusDoc | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    onData(null);
    return () => undefined;
  }
  return onSnapshot(
    statusRef(month),
    (snap) => {
      onData(snap.exists() ? (snap.data() as BonusMonthStatusDoc) : null);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export function subscribeBonusPersonalClose(
  month: string,
  employeeId: string,
  onData: (doc: BonusPersonalCloseDoc | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  if (!/^\d{4}-\d{2}$/.test(month) || !employeeId.trim()) {
    onData(null);
    return () => undefined;
  }
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let unsub: Unsubscribe = () => undefined;

  const start = (attempt = 0) => {
    if (stopped) return;
    unsub = onSnapshot(
      personalRef(month, employeeId),
      (snap) => {
        if (stopped) return;
        onData(snap.exists() ? (snap.data() as BonusPersonalCloseDoc) : null);
      },
      (err) => {
        if (stopped) return;
        const e = err instanceof Error ? err : new Error(String(err));
        const code = (err as { code?: string })?.code || "";
        const retryable =
          code === "permission-denied" ||
          /insufficient permissions|unavailable|network/i.test(e.message);
        if (retryable && attempt < 3) {
          unsub();
          retryTimer = setTimeout(() => start(attempt + 1), 1200 * (attempt + 1));
          return;
        }
        onError?.(e);
      },
    );
  };

  start();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    unsub();
  };
}

export async function writeBonusCloseSideDocs(close: BonusMonthCloseDoc): Promise<void> {
  const db = getDb();
  await setDoc(statusRef(close.month), {
    month: close.month,
    status: "closed",
    closedAt: close.closedAt,
    closedBy: close.closedBy,
  } satisfies BonusMonthStatusDoc);

  const rows = close.snapshot.rows || [];
  let batch = writeBatch(db);
  let ops = 0;
  for (const row of rows) {
    const empId = (row.workerId || "").trim();
    if (!empId) continue;
    batch.set(personalRef(close.month, empId), {
      month: close.month,
      employeeId: empId,
      employeeName: row.workerName,
      status: "closed",
      closedAt: close.closedAt,
      shopDeductPct: close.snapshot.shopDeductPct,
      row,
    } satisfies BonusPersonalCloseDoc);
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}

export async function deleteBonusCloseSideDocs(month: string): Promise<void> {
  const db = getDb();
  await deleteDoc(statusRef(month)).catch(() => undefined);
  const snap = await getDocs(
    query(collection(db, BONUS_PERSONAL_CLOSE_COL), where("month", "==", month)),
  );
  let batch = writeBatch(db);
  let ops = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}

/** จาก close ทั้งร้านที่เจ้าของมี — เติม status + personal ถ้ายังไม่มี (migrate) */
export async function ensureBonusCloseSideDocsFromShopClose(
  close: BonusMonthCloseDoc,
): Promise<void> {
  const status = await getBonusMonthStatus(close.month);
  if (status?.status === "closed") {
    // ตรวจว่ามี personal อย่างน้อย 1 แถว
    const sample = close.snapshot.rows.find((r) => r.workerId);
    if (sample?.workerId) {
      const p = await getDoc(personalRef(close.month, sample.workerId));
      if (p.exists()) return;
    } else {
      return;
    }
  }
  await writeBonusCloseSideDocs(close);
}

export function workerRowFromPersonalClose(
  personal: BonusPersonalCloseDoc,
): WorkerMonthBonus {
  const r = personal.row;
  return {
    workerId: r.workerId,
    workerName: r.workerName,
    salesShare: r.salesShare,
    prodBonus: r.prodBonus,
    otMain: r.otMain,
    total: r.total,
    deductPct: r.deductPct,
    deductAmount: r.deductAmount,
    remaining: r.remaining,
    workedThisMonth: r.workedThisMonth,
  };
}
