/**
 * เติม bonusMonthStatus + bonusPersonalCloses จาก bonusMonthCloses ที่มีอยู่
 * เรียกตอนเจ้าของเข้าแอป / เปิดหน้าจ่าย
 */
import { collection, getDocs } from "firebase/firestore";
import { BONUS_MONTH_CLOSE_COL, type BonusMonthCloseDoc } from "./bonus-month-guard";
import { ensureBonusCloseSideDocsFromShopClose } from "./bonus-personal-close";
import { getDb } from "./firebase";

export async function migrateAllBonusCloseSideDocs(): Promise<number> {
  const snap = await getDocs(collection(getDb(), BONUS_MONTH_CLOSE_COL));
  let n = 0;
  for (const d of snap.docs) {
    const data = d.data() as BonusMonthCloseDoc;
    if (data.status !== "closed") continue;
    await ensureBonusCloseSideDocsFromShopClose({ ...data, month: data.month || d.id });
    n += 1;
  }
  return n;
}
