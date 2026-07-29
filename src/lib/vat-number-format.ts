/**
 * รูปแบบตัวเลขหน้า VAT / กำไรขาดทุน / ระบบเงินในร้าน
 * มาตรฐานบังคับ: docs/vat-number-format.md
 *
 * กฎสั้น: เงินแสดงและในช่องกรอกต้องมีคอมม่าหลักพันเสมอ (12,345.67)
 * ทั้งค่าที่คนพิมพ์ · ระบบเจน · ดึงจากบช.
 */

/** บาท · เงิน · ภาษี — ทศนิยม 2 + คอมม่าหลักพันเสมอ */
export function formatVatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * เปอร์เซ็นต์แสดงผล — ทศนิยม 2 + เครื่องหมาย %
 * @param pct ค่าเป็นเปอร์เซ็นต์ (7 = 7%) ไม่ใช่เศษ 0–1
 */
export function formatVatPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${formatVatMoney(pct)}%`;
}

/** จำนวนเต็ม (วัน / ชิ้น / นับ) — คอมม่าเมื่อถึงหลักพัน · ไม่มีทศนิยม */
export function formatVatInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/** ค่าว่างในตารางเงิน → "—" · มีค่า (รวม 0) → ทศนิยม 2 + คอมม่า */
export function formatVatMoneyOrDash(n: number, treatZeroAsEmpty = false): string {
  if (!Number.isFinite(n)) return "—";
  if (treatZeroAsEmpty && n === 0) return "—";
  return formatVatMoney(n);
}

/**
 * ค่าในช่องกรอกเงิน — รูปแบบเดียวกับแสดงผล (มีคอมม่า + ทศนิยม 2)
 * ว่างเมื่อ 0 เพื่อให้ placeholder ชัด
 */
export function moneyFieldValue(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return formatVatMoney(n);
}

/**
 * parse ช่องกรอกเงิน — ตัดคอมม่า / ช่องว่างก่อน Number
 * ใช้ทั้งตอนคำนวณและตอน blur format กลับ
 */
export function parseVatMoneyInput(raw: string): number {
  const t = String(raw ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** จัดรูปข้อความเงินในช่องกรอกหลังพิมพ์/ระบบเติม (คงว่างถ้าว่าง) */
export function normalizeMoneyFieldText(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  return formatVatMoney(parseVatMoneyInput(t));
}

/** ค่าในช่องกรอก % — ทศนิยม 2 เมื่อมีค่า (คอมม่าถ้าถึงหลักพัน) */
export function pctFieldValue(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return formatVatMoney(n);
}

/** parse ช่อง % — ตัดคอมม่า/% */
export function parseVatPctInput(raw: string, fallback = 0): number {
  const t = String(raw ?? "")
    .trim()
    .replace(/%/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  if (!t) return fallback;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
}

export type VatNumberKind = "money" | "pct" | "int";

export const VAT_NUMBER_KIND_HINT: Record<
  VatNumberKind,
  { decimals: number; comma: boolean; use: string }
> = {
  money: {
    decimals: 2,
    comma: true,
    use: "บาท · ยอดขาย · ภาษี · GP · รายได้ · ลดหย่อน · ช่องกรอกเงิน",
  },
  pct: {
    decimals: 2,
    comma: true,
    use: "เรทขาย · นำส่ง% · GP หัก% · GP ของภาษีขาย",
  },
  int: {
    decimals: 0,
    comma: true,
    use: "นับวัน · จำนวนชิ้น · ลำดับ",
  },
};
