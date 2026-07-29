/**
 * รูปแบบตัวเลขหน้า VAT / กำไรขาดทุนบุคคล
 * ดู docs/vat-number-format.md
 */

/** บาท · เงิน · ภาษี — ทศนิยม 2 ตำแหน่งเสมอ */
export function formatVatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * เปอร์เซ็นต์แสดงผล — ทศนิยม 2 ตำแหน่ง + เครื่องหมาย %
 * @param pct ค่าเป็นเปอร์เซ็นต์ (7 = 7%) ไม่ใช่เศษ 0–1
 */
export function formatVatPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${formatVatMoney(pct)}%`;
}

/** จำนวนเต็ม (วัน / ชิ้น / นับ) — ไม่มีทศนิยม */
export function formatVatInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/** ค่าว่างในตารางเงิน → "—" · มีค่า (รวม 0) → ทศนิยม 2 */
export function formatVatMoneyOrDash(n: number, treatZeroAsEmpty = false): string {
  if (!Number.isFinite(n)) return "—";
  if (treatZeroAsEmpty && n === 0) return "—";
  return formatVatMoney(n);
}

/** ค่าในช่องกรอกเงิน — ทศนิยม 2 เมื่อมีค่า */
export function moneyFieldValue(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** ค่าในช่องกรอก % — ทศนิยม 2 เมื่อมีค่า */
export function pctFieldValue(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return (Math.round(n * 100) / 100).toFixed(2);
}

export type VatNumberKind = "money" | "pct" | "int";

export const VAT_NUMBER_KIND_HINT: Record<
  VatNumberKind,
  { decimals: number; use: string }
> = {
  money: { decimals: 2, use: "บาท · ยอดขาย · ภาษี · GP · รายได้ · ลดหย่อน" },
  pct: { decimals: 2, use: "เรทขาย · นำส่ง% · GP หัก% · GP ของภาษีขาย" },
  int: { decimals: 0, use: "นับวัน · จำนวนชิ้น · ลำดับ" },
};
