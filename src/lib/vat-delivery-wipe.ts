/**
 * ล้างยอดเดลิเวอรี่ในงบเดือน — เริ่มใหม่
 * แหล่งตัวเลขเดิม: vatMonthlyReturns (จากนำเข้ารายวัน/กรอกเก่า)
 * ไม่แตะหน้าร้าน / ภาษีซื้อจากสองบช. (ingredientVat)
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  emptyGpChannelDeduct,
  mapGpByChannel,
} from "./personal-income-tax";
import {
  EMPTY_DELIVERY_CHANNELS,
  loadVatMonthlyReturn,
  loadVatMonthlySettings,
  recomputeSegment,
  saveVatMonthlySettings,
  sumMonthlyTotals,
  VAT_MONTHLY_COL,
  type VatMonthlyReturn,
} from "./vat-monthly";
import { VAT_IMPORT_ROWS_COL } from "./vat-import";
import { notifyVatImportMonthMerged } from "./vat-import-month-sync";
import { normalizeMoney, roundMoney } from "./vat-sales";

export type WipeDeliveryReport = {
  monthsCleared: string[];
  importRowsDeleted: number;
  settingsCleared: boolean;
};

function emptyDeliveryGp() {
  return {
    shopee: emptyGpChannelDeduct(0, "transfer"),
    grab: emptyGpChannelDeduct(0, "transfer"),
    lineman: emptyGpChannelDeduct(0, "transfer"),
  };
}

/** ล้างยอดเดลิเวอรี่ในเอกสารเดือนหนึ่ง (บังคับได้แม้ filed) */
export async function wipeDeliveryTotalsForMonth(
  monthKey: string,
  actor: string,
): Promise<VatMonthlyReturn> {
  const current = await loadVatMonthlyReturn(monthKey);
  const gp = mapGpByChannel(current.pnlGpByChannel);
  const wipedGp = {
    ...gp,
    ...emptyDeliveryGp(),
    // เก็บหน้าร้านไว้
    storefront: gp.storefront,
  };

  const delivery = recomputeSegment({
    ...current.delivery,
    kind: "delivery",
    grossManual: 0,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    gpVat: 0,
    useGpEstimate: false,
  });
  const storefront = recomputeSegment(current.storefront);
  const totals = sumMonthlyTotals(
    delivery,
    storefront,
    delivery.grossSales,
    storefront.grossSales,
  );

  // รายได้ถึงร้านหลังล้าง = เฉพาะหน้าร้าน (ถ้ามี)
  const storefrontIncome = normalizeMoney(wipedGp.storefront.netTransfer);
  const pnlIncome =
    storefrontIncome > 0
      ? storefrontIncome
      : normalizeMoney(storefront.reportedGross);

  const next: VatMonthlyReturn = {
    ...current,
    delivery,
    storefront,
    totals,
    pnlIncome,
    pnlDeliveryGpDeduct: 0,
    pnlDeliveryGpMode: "transfer",
    pnlDeliveryGpPct: 0,
    pnlGpByChannel: wipedGp,
    // เริ่มใหม่ — ปลดปิดงบถ้าเคยปิด
    status: current.status === "filed" ? "draft" : current.status,
    filedAt: 0,
    filedBy: "",
    updatedAt: Date.now(),
    updatedBy: actor || "owner",
  };

  await setDoc(doc(getDb(), VAT_MONTHLY_COL, monthKey), next, { merge: true });
  notifyVatImportMonthMerged(monthKey, next);
  return next;
}

export async function listVatMonthlyMonthKeys(): Promise<string[]> {
  const snap = await getDocs(collection(getDb(), VAT_MONTHLY_COL));
  return snap.docs
    .map((d) => d.id)
    .filter((id) => /^\d{4}-\d{2}$/.test(id))
    .sort();
}

async function deleteAllVatImportRows(): Promise<number> {
  const snap = await getDocs(collection(getDb(), VAT_IMPORT_ROWS_COL));
  let n = 0;
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
    n += 1;
  }
  return n;
}

async function clearDeliveryFromSettings(actor: string): Promise<boolean> {
  const current = await loadVatMonthlySettings();
  const empty = emptyDeliveryGp();
  await saveVatMonthlySettings(
    {
      pnlGpByChannel: {
        ...current.pnlGpByChannel,
        ...empty,
        storefront: current.pnlGpByChannel.storefront,
      },
    },
    actor || "owner",
  );
  return true;
}

/** ล้างยอดเดลิเวอรี่ทุกเดือน + แถวนำเข้ารายวันเก่า */
export async function wipeAllDeliveryTotals(
  actor: string,
): Promise<WipeDeliveryReport> {
  const keys = await listVatMonthlyMonthKeys();
  const monthsCleared: string[] = [];
  for (const key of keys) {
    await wipeDeliveryTotalsForMonth(key, actor);
    monthsCleared.push(key);
  }
  const importRowsDeleted = await deleteAllVatImportRows();
  const settingsCleared = await clearDeliveryFromSettings(actor);
  return {
    monthsCleared,
    importRowsDeleted,
    settingsCleared,
  };
}

export function summarizeWipe(report: WipeDeliveryReport): string {
  const months = report.monthsCleared.length
    ? report.monthsCleared.join(", ")
    : "ไม่มีเอกสารเดือน";
  return `ล้างเดลิเวอรี่ ${report.monthsCleared.length} เดือน (${months}) · แถวนำเข้า ${report.importRowsDeleted} · ตั้งค่า GP เคลียร์`;
}

export { roundMoney };
