/**
 * ปิดเดือนโบนัส — snapshot ยอด + ล็อกชง/ผลิตทั้งเดือน
 */
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import type { MonthBonusReport } from "./bonus";
import { isInMonth } from "./bonus";
import {
  BONUS_MONTH_CLOSE_COL,
  getBonusMonthClose,
  type BonusMonthCloseDoc,
} from "./bonus-month-guard";
import { getDb } from "./firebase";
import { bulkUpdateOtEntryStatus, type OtEntry } from "./ot";
import { parsePeriodMonth } from "./payroll";
import { bulkUpdateProdEntryStatus, type ProdEntry } from "./production";

export type { BonusMonthCloseDoc } from "./bonus-month-guard";
export {
  BONUS_MONTH_CLOSE_COL,
  getBonusMonthClose,
  isBonusMonthClosed,
  periodMonthFromDateMs,
  subscribeBonusMonthClose,
  assertBonusMonthOpenForDate,
} from "./bonus-month-guard";

function closeRef(month: string) {
  return doc(getDb(), BONUS_MONTH_CLOSE_COL, month);
}

function snapshotFromReport(report: MonthBonusReport): BonusMonthCloseDoc["snapshot"] {
  return {
    employeeCount: report.employeeCount,
    totalProdQty: report.totalProdQty,
    totalSalesPool: report.totalSalesPool,
    shopDeductPct: report.shopDeductPct,
    totalDeducted: report.totalDeducted,
    totalRemaining: report.totalRemaining,
    rows: report.rows.map((r) => ({
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
    })),
  };
}

/** Lock every prod/ot row in the period month (status → paid). */
export async function lockBonusSourceEntriesForMonth(
  periodMonth: string,
  prodEntries: ProdEntry[],
  otEntries: OtEntry[],
): Promise<{ prod: number; ot: number }> {
  const { year, monthIndex } = parsePeriodMonth(periodMonth);
  const prodIds = prodEntries
    .filter((e) => e.status !== "paid" && isInMonth(e.date, year, monthIndex))
    .map((e) => e.id);
  const otIds = otEntries
    .filter((e) => e.status !== "paid" && isInMonth(e.date, year, monthIndex))
    .map((e) => e.id);
  const prod = prodIds.length ? await bulkUpdateProdEntryStatus(prodIds, "paid") : 0;
  const ot = otIds.length ? await bulkUpdateOtEntryStatus(otIds, "paid") : 0;
  return { prod, ot };
}

/**
 * ปิดเดือนโบนัส: เก็บ snapshot ยอด → ล็อกชง/ผลิตทั้งเดือน
 * หลังปิด สร้างคิวโบนัสได้ที่แท็บรอโอน (จากยอด snapshot)
 */
export async function closeBonusMonth(input: {
  periodMonth: string;
  closedBy: string;
  report: MonthBonusReport;
  prodEntries: ProdEntry[];
  otEntries: OtEntry[];
}): Promise<BonusMonthCloseDoc> {
  const month = input.periodMonth;
  parsePeriodMonth(month);
  if (!input.closedBy) throw new Error("ต้องระบุผู้ปิดเดือน");

  const existing = await getBonusMonthClose(month);
  if (existing?.status === "closed") {
    throw new Error(`เดือน ${month} ปิดแล้ว`);
  }

  const { prod, ot } = await lockBonusSourceEntriesForMonth(
    month,
    input.prodEntries,
    input.otEntries,
  );

  const docData: BonusMonthCloseDoc = {
    month,
    status: "closed",
    closedAt: Date.now(),
    closedBy: input.closedBy,
    snapshot: snapshotFromReport(input.report),
    lockedProd: prod,
    lockedOt: ot,
  };
  await setDoc(closeRef(month), docData);
  return docData;
}

/** ปลดปิดเดือน (เจ้าของ) — แถว paid ยังล็อกยอด; อนุญาตลงแถวใหม่ในเดือนนั้น */
export async function unlockBonusMonth(periodMonth: string): Promise<void> {
  parsePeriodMonth(periodMonth);
  const existing = await getBonusMonthClose(periodMonth);
  if (!existing) throw new Error("เดือนนี้ยังไม่ถูกปิด");
  await deleteDoc(closeRef(periodMonth));
}

export function reportFromCloseSnapshot(close: BonusMonthCloseDoc): MonthBonusReport {
  const { year, monthIndex } = parsePeriodMonth(close.month);
  return {
    year,
    month: monthIndex,
    employeeCount: close.snapshot.employeeCount,
    totalProdQty: close.snapshot.totalProdQty,
    totalSalesPool: close.snapshot.totalSalesPool,
    shopDeductPct: close.snapshot.shopDeductPct,
    deductionLines: [],
    totalDeducted: close.snapshot.totalDeducted,
    totalRemaining: close.snapshot.totalRemaining,
    rows: close.snapshot.rows.map((r) => ({ ...r })),
  };
}
