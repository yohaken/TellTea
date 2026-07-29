/**
 * รวมภาษีซื้อจากบช.พนักงาน + บช.เจ้าของ → ใช้ใน VAT เดือน
 *
 * สูตร VAT เดือน:
 *   ภาษีซื้อรวม = GP (เดลิเวอรี่) + วัตถุดิบ
 *   วัตถุดิบ ← ผลรวม vatInput ของรายการที่ติ๊ก「รวมเข้าระบบ」(vatClaim) ในเดือนนั้น
 *
 * รายการที่มียอด VAT บนบิล (hasVat) แสดงในตาราง + ทั้งหมด
 * แต่ดึงเข้าระบบเฉพาะที่ vatClaim
 *
 * ห้ามบันทึกบิลซ้ำสองบช. (จะนับภาษีซื้อซ้ำ)
 */
import { monthKeyFromMs } from "./categories";
import { listLedgerEntriesInMonth } from "./ledger";
import { listOwnerBookEntries } from "./owner-books";
import { normalizeMoney, roundMoney } from "./vat-sales";

export type BooksVatBook = "ledger" | "owner";

/** รายการย่อยที่มีภาษีซื้อบนบิล — ใช้แจกแจงใต้ตารางภาษีซื้อ */
export type BooksVatLine = {
  id: string;
  book: BooksVatBook;
  date: number;
  description: string;
  amountOut: number;
  vatInput: number;
  vatVerified: boolean;
  vatSource: string;
  /** รวมเข้าหัก VAT เดือน */
  vatClaim: boolean;
};

export type BooksVatMonthSum = {
  monthKey: string;
  /** ยอดที่ติ๊กรวมเข้าระบบเท่านั้น */
  ledgerVat: number;
  ledgerCount: number;
  ownerVat: number;
  ownerCount: number;
  /** ledger + owner (claimed) */
  vatInput: number;
  count: number;
  /** จำนวนรายการที่มี VAT บนบิลทั้งหมด (รวมยังไม่ติ๊ก) */
  allCount: number;
};

export type BooksVatMonthBundle = BooksVatMonthSum & {
  lines: BooksVatLine[];
};

function bookLabel(book: BooksVatBook): string {
  return book === "ledger" ? "พนง." : "เจ้าของ";
}

export { bookLabel };

/** โหลดยอดรวม (claimed) + รายการย่อยทั้งหมดที่มี VAT ในเดือน */
export async function loadBothBooksVatByMonth(
  monthKey: string,
): Promise<BooksVatMonthBundle> {
  const empty: BooksVatMonthBundle = {
    monthKey,
    ledgerVat: 0,
    ledgerCount: 0,
    ownerVat: 0,
    ownerCount: 0,
    vatInput: 0,
    count: 0,
    allCount: 0,
    lines: [],
  };
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return empty;

  const [ys, ms] = monthKey.split("-");
  const year = Number(ys);
  const month = Number(ms);
  if (!year || !month) return empty;

  const [ledgerRows, ownerRows] = await Promise.all([
    listLedgerEntriesInMonth(year, month),
    listOwnerBookEntries(),
  ]);

  const lines: BooksVatLine[] = [];
  let ledgerVat = 0;
  let ledgerCount = 0;
  let ownerVat = 0;
  let ownerCount = 0;

  for (const row of ledgerRows) {
    if (!row.hasVat || row.amountOut <= 0) continue;
    const v = normalizeMoney(row.vatInput);
    if (v <= 0) continue;
    const claimed = Boolean(row.vatClaim);
    if (claimed) {
      ledgerVat = roundMoney(ledgerVat + v);
      ledgerCount += 1;
    }
    lines.push({
      id: row.id,
      book: "ledger",
      date: row.date,
      description: String(row.description || "").trim() || "—",
      amountOut: normalizeMoney(row.amountOut),
      vatInput: v,
      vatVerified: Boolean(row.vatVerified),
      vatSource: String(row.vatSource || ""),
      vatClaim: claimed,
    });
  }

  for (const row of ownerRows) {
    if (!row.hasVat) continue;
    if (monthKeyFromMs(row.date) !== monthKey) continue;
    const v = normalizeMoney(row.vatInput);
    if (v <= 0) continue;
    const claimed = Boolean(row.vatClaim);
    if (claimed) {
      ownerVat = roundMoney(ownerVat + v);
      ownerCount += 1;
    }
    lines.push({
      id: row.id,
      book: "owner",
      date: row.date,
      description: String(row.description || "").trim() || "—",
      amountOut: normalizeMoney(row.amountOut),
      vatInput: v,
      vatVerified: Boolean(row.vatVerified),
      vatSource: String(row.vatSource || ""),
      vatClaim: claimed,
    });
  }

  lines.sort((a, b) => b.date - a.date || a.description.localeCompare(b.description));

  return {
    monthKey,
    ledgerVat,
    ledgerCount,
    ownerVat,
    ownerCount,
    vatInput: roundMoney(ledgerVat + ownerVat),
    count: ledgerCount + ownerCount,
    allCount: lines.length,
    lines,
  };
}

export async function sumBothBooksVatInputByMonth(
  monthKey: string,
): Promise<BooksVatMonthSum> {
  const { lines: _lines, ...sum } = await loadBothBooksVatByMonth(monthKey);
  return sum;
}
