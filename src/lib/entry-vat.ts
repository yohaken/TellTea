/**
 * ช่อง VAT (ภาษีซื้อ) ร่วม — บช.พนักงาน + บช.เจ้าของ
 *
 * ลำดับหลัก:
 * 1) AI อ่านจากรูปใบเสร็จก่อน
 * 2) คนติ๊กตรวจว่าตรงบิล
 * 3) ถ้าไม่มี AI / ไม่ตรง → กรอกเอง
 * 4) ประมาณ ×7/107 เป็นทางเลือกสุดท้าย (ไม่ใช่ค่าเริ่มต้น)
 */
import { computeVatFromGross, normalizeMoney, roundMoney } from "./vat-sales";

/** ที่มาของยอดภาษีซื้อ */
export type VatSource = "" | "ai" | "manual" | "propose";

export type EntryVatFields = {
  hasVat: boolean;
  vatInput: number;
  vatBase: number;
  vatInvoiceNo: string;
  /** ai | manual | propose */
  vatSource: VatSource;
  /** คนติ๊กตรวจแล้วว่าตรงกับบิล */
  vatVerified: boolean;
};

/** ผู้ขายที่พบบ่อย — hint UI */
export const COMMON_VAT_VENDORS = [
  "แม็คโคร",
  "ท็อปส์",
  "ท็อปแวลู",
  "บิ๊กซี",
  "โลตัส",
] as const;

export function normalizeVatSource(raw: unknown): VatSource {
  const s = String(raw || "").trim();
  if (s === "ai" || s === "manual" || s === "propose") return s;
  return "";
}

/** ประมาณจากยอดจ่าย ×7/107 — ใช้เมื่อกดเองเท่านั้น ไม่ใช้แทนบิล */
export function proposePurchaseVatInput(amountInclusive: number): number {
  return computeVatFromGross(normalizeMoney(amountInclusive)).vatOutput;
}

/**
 * normalize ตอนโหลด/บันทึก
 * ถ้า hasVat แต่ไม่มี vatInput → คง 0 (ไม่บังคับใส่ 7/107)
 */
export function normalizePurchaseVat(
  raw: Partial<EntryVatFields> | undefined,
  amountInclusive = 0,
): EntryVatFields {
  const hasVat = Boolean(raw?.hasVat);
  if (!hasVat) {
    return {
      hasVat: false,
      vatInput: 0,
      vatBase: 0,
      vatInvoiceNo: "",
      vatSource: "",
      vatVerified: false,
    };
  }
  const vatInputRaw = Number(raw?.vatInput);
  const vatInput =
    Number.isFinite(vatInputRaw) && vatInputRaw > 0
      ? normalizeMoney(vatInputRaw)
      : 0;
  const vatBaseRaw = Number(raw?.vatBase);
  const vatBase =
    Number.isFinite(vatBaseRaw) && vatBaseRaw > 0
      ? normalizeMoney(vatBaseRaw)
      : vatInput > 0
        ? roundMoney(Math.max(0, normalizeMoney(amountInclusive) - vatInput))
        : 0;
  const vatSource = normalizeVatSource(raw?.vatSource);
  const vatVerified = Boolean(raw?.vatVerified) && vatInput > 0;
  return {
    hasVat: true,
    vatInput,
    vatBase,
    vatInvoiceNo: String(raw?.vatInvoiceNo || "").trim(),
    vatSource: vatSource || (vatInput > 0 ? "manual" : ""),
    vatVerified,
  };
}

/** parse ช่องกรอก — ว่าง = 0 ไม่ fallback 7/107 */
export function parseVatInputStr(raw: string): number {
  const n = Number(String(raw || "").replace(/,/g, ""));
  if (Number.isFinite(n) && n > 0) return normalizeMoney(n);
  return 0;
}

/** ผล AI ที่เกี่ยวกับ VAT (หลัง normalize ฝั่ง client) */
export type AiVatExtract = {
  hasVat: boolean;
  vatInput: number | null;
  vatBase: number | null;
  vatInvoiceNo: string;
  /** AI มองเห็นบรรทัดภาษีบนบิลชัดหรือไม่ */
  vatSeenOnBill: boolean;
  vatReason: string;
};

export function normalizeAiVatExtract(raw: {
  hasVat?: unknown;
  vatInput?: unknown;
  vatBase?: unknown;
  vatInvoiceNo?: unknown;
  vatSeenOnBill?: unknown;
  vatReason?: unknown;
}): AiVatExtract {
  const vatInputRaw = Number(raw.vatInput);
  const vatInput =
    Number.isFinite(vatInputRaw) && vatInputRaw > 0
      ? normalizeMoney(vatInputRaw)
      : null;
  const vatBaseRaw = Number(raw.vatBase);
  const vatBase =
    Number.isFinite(vatBaseRaw) && vatBaseRaw > 0
      ? normalizeMoney(vatBaseRaw)
      : null;
  const hasVat =
    raw.hasVat === true ||
    raw.hasVat === "true" ||
    (vatInput != null && vatInput > 0);
  const vatSeenOnBill =
    raw.vatSeenOnBill === true ||
    raw.vatSeenOnBill === "true" ||
    (hasVat && vatInput != null);
  return {
    hasVat: Boolean(hasVat && vatInput != null),
    vatInput,
    vatBase,
    vatInvoiceNo: String(raw.vatInvoiceNo || "").trim().slice(0, 80),
    vatSeenOnBill: Boolean(vatSeenOnBill && vatInput != null),
    vatReason: String(raw.vatReason || "").trim().slice(0, 80),
  };
}
