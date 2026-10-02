/**
 * งวด VAT ที่ยื่นแล้ว (vatMonthlyReturns/{YYYY-MM}.status === "filed")
 * ใช้เตือนก่อนเปลี่ยนประเภทบัญชีย้อนหลัง — อ่านอย่างเดียว ไม่ปลดล็อกงวด
 */

import { doc, getDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { VAT_MONTHLY_COL } from "./vat-monthly";
import { bangkokMonthKey, isMonthKey } from "./vat-sales";

/** เดือนบัญชีของรายการ ตามเวลากรุงเทพฯ (ตรงกับงวด VAT) */
export function ledgerMonthKey(dateMs: number): string {
  return dateMs > 0 ? bangkokMonthKey(dateMs) : "";
}

export async function getFiledMonths(monthKeys: string[]): Promise<string[]> {
  const keys = [...new Set(monthKeys.filter(isMonthKey))].sort();
  const db = getDb();
  const filed = await Promise.all(
    // อ่านไม่ได้ให้ throw — ห้ามถือว่า "ยังไม่ปิด" แล้วเขียนทับเงียบ ๆ
    keys.map(async (key) => {
      const snap = await getDoc(doc(db, VAT_MONTHLY_COL, key));
      return snap.exists() && snap.data()?.status === "filed" ? key : "";
    }),
  );
  return filed.filter(Boolean);
}
