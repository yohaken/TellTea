/**
 * ปิดเดือน VAT → monthlyIncome (+ audit owner-only)
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { saveMonthlyIncome } from "./pnl";
import {
  isMonthKey,
  listDailySalesInMonth,
  loadVatSalesSettings,
  proposeMonthlyIncomeAmount,
  type DailySalesDoc,
  type MonthSalesTotals,
  type PnlIncomeMode,
} from "./vat-sales";
import { appendVatSalesAudit } from "./vat-sales-audit";

export const VAT_MONTH_CLOSE_COL = "vatMonthCloses";

export type VatMonthCloseAudit = {
  month: string;
  income: number;
  pnlIncomeMode: PnlIncomeMode;
  confirmedDays: number;
  totals: MonthSalesTotals;
  previousIncome: number;
  closedAt: number;
  closedBy: string;
};

export async function getMonthlyIncomeValue(month: string): Promise<number> {
  if (!isMonthKey(month)) throw new Error("เดือนไม่ถูกต้อง");
  const snap = await getDoc(doc(getDb(), "monthlyIncome", month));
  if (!snap.exists()) return 0;
  return Number(snap.data().income) || 0;
}

export async function getVatMonthCloseAudit(
  month: string,
): Promise<VatMonthCloseAudit | null> {
  const snap = await getDoc(doc(getDb(), VAT_MONTH_CLOSE_COL, month));
  if (!snap.exists()) return null;
  return snap.data() as VatMonthCloseAudit;
}

export async function buildMonthClosePreview(month: string): Promise<{
  docs: DailySalesDoc[];
  mode: PnlIncomeMode;
  proposed: number;
  confirmedDays: number;
  dayCount: number;
  totals: MonthSalesTotals;
  currentIncome: number;
  lastClose: VatMonthCloseAudit | null;
  vatRegistered: boolean;
}> {
  const [docsMap, settings, currentIncome, lastClose] = await Promise.all([
    listDailySalesInMonth(month),
    loadVatSalesSettings(),
    getMonthlyIncomeValue(month),
    getVatMonthCloseAudit(month),
  ]);
  const docs = Object.values(docsMap);
  const { amount, confirmedDays, totals } = proposeMonthlyIncomeAmount(
    docs,
    settings.pnlIncomeMode,
  );
  return {
    docs,
    mode: settings.pnlIncomeMode,
    proposed: amount,
    confirmedDays,
    dayCount: docs.length,
    totals,
    currentIncome,
    lastClose,
    vatRegistered: Boolean(settings.vatRegistered),
  };
}

export async function closeVatMonthToIncome(
  month: string,
  closedBy: string,
  opts?: { forceIncome?: number },
): Promise<VatMonthCloseAudit> {
  if (!isMonthKey(month)) throw new Error("เดือนไม่ถูกต้อง");
  const preview = await buildMonthClosePreview(month);
  if (preview.confirmedDays <= 0) {
    throw new Error("ยังไม่มีวันที่ยืนยันในเดือนนี้");
  }
  const income =
    opts?.forceIncome != null ? Number(opts.forceIncome) : preview.proposed;
  if (!Number.isFinite(income) || income < 0) {
    throw new Error("ยอดรายได้ไม่ถูกต้อง");
  }

  await saveMonthlyIncome(month, income, closedBy);

  const audit: VatMonthCloseAudit = {
    month,
    income,
    pnlIncomeMode: preview.mode,
    confirmedDays: preview.confirmedDays,
    totals: preview.totals,
    previousIncome: preview.currentIncome,
    closedAt: Date.now(),
    closedBy,
  };
  await setDoc(doc(getDb(), VAT_MONTH_CLOSE_COL, month), audit, { merge: true });
  await appendVatSalesAudit({
    action: "close_month",
    monthKey: month,
    summary: `ปิดเดือน ${month} · รายได้ ${income}`,
    before: { income: preview.currentIncome },
    after: {
      income,
      confirmedDays: preview.confirmedDays,
      vatOutput: preview.totals.vatOutput,
    },
    actor: closedBy,
  });
  return audit;
}
