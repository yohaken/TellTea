import { collection, getDocs } from "firebase/firestore";
import { getDb } from "./firebase";
import {
  VAT_MONTHLY_COL,
  loadVatMonthlySettings,
  mapVatMonthlyReturn,
  type VatMonthlyReturn,
} from "./vat-monthly";
import { deriveMonthBooksView, retToMonthBooksDraft } from "./vat-month-books";
import { roundMoney } from "./vat-sales";

/** ตัวเลขจากหน้า VAT รายเดือนที่ P&L ดึงไปใช้ตรง ๆ */
export type PnlVatMonth = {
  /** รายได้ถึงร้าน = ยอดโอนเดลิเวอรี่ (หลังหัก GP) + หน้าร้าน */
  income: number;
  outputVat: number;
  /** ภาษีขาย − ภาษีซื้อที่นำมาหัก · ติดลบ = ได้คืน */
  netVat: number;
  status: VatMonthlyReturn["status"];
};

export function vatReturnToPnlMonth(ret: VatMonthlyReturn): PnlVatMonth {
  const view = deriveMonthBooksView(retToMonthBooksDraft(ret));
  // เอกสารรุ่นเก่าไม่มียอดโอนรายช่องทาง → ใช้ยอดที่เคยส่งเข้า P&L
  const income =
    view.incomeTotal > 0 ? view.incomeTotal : roundMoney(ret.pnlIncome || 0);
  return {
    income,
    outputVat: view.outputVat,
    netVat: view.netVat,
    status: ret.status,
  };
}

function hasVatData(m: PnlVatMonth): boolean {
  return m.income > 0 || m.outputVat > 0 || m.netVat !== 0;
}

/** ทุกเดือนที่บันทึกไว้ในหน้า VAT (ร่าง/บันทึก/ปิด) · ไม่ต้องกดส่งเข้า P&L */
export async function loadVatMonthsForPnl(): Promise<Record<string, PnlVatMonth>> {
  const [snap, settings] = await Promise.all([
    getDocs(collection(getDb(), VAT_MONTHLY_COL)),
    loadVatMonthlySettings(),
  ]);
  const out: Record<string, PnlVatMonth> = {};
  for (const d of snap.docs) {
    if (!/^\d{4}-\d{2}$/.test(d.id)) continue;
    const ret = mapVatMonthlyReturn(
      d.id,
      d.data() as Partial<VatMonthlyReturn>,
      settings,
    );
    const m = vatReturnToPnlMonth(ret);
    if (hasVatData(m)) out[d.id] = m;
  }
  return out;
}
