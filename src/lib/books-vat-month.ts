/**
 * รวมภาษีซื้อจากบช.พนักงาน + บช.เจ้าของ → ใช้ใน VAT เดือน
 *
 * สูตร VAT เดือน:
 *   ภาษีซื้อรวม = GP (เดลิเวอรี่) + วัตถุดิบ
 *   วัตถุดิบ ← ผลรวม vatInput ของรายการที่ติ๊ก hasVat ในเดือนนั้น
 *
 * ห้ามบันทึกบิลซ้ำสองบช. (จะนับภาษีซื้อซ้ำ)
 */
import { sumLedgerVatInputByMonth } from "./ledger";
import { sumOwnerBooksVatInputByMonth } from "./owner-books";
import { roundMoney } from "./vat-sales";

export type BooksVatMonthSum = {
  monthKey: string;
  ledgerVat: number;
  ledgerCount: number;
  ownerVat: number;
  ownerCount: number;
  /** ledger + owner */
  vatInput: number;
  count: number;
};

export async function sumBothBooksVatInputByMonth(
  monthKey: string,
): Promise<BooksVatMonthSum> {
  const [ledger, owner] = await Promise.all([
    sumLedgerVatInputByMonth(monthKey),
    sumOwnerBooksVatInputByMonth(monthKey),
  ]);
  return {
    monthKey,
    ledgerVat: ledger.vatInput,
    ledgerCount: ledger.count,
    ownerVat: owner.vatInput,
    ownerCount: owner.count,
    vatInput: roundMoney(ledger.vatInput + owner.vatInput),
    count: ledger.count + owner.count,
  };
}
