/**
 * ช่อง VAT (ภาษีซื้อ) ร่วม — ใช้ทั้งบช.พนักงาน (ledger) และบช.เจ้าของ
 * บิลเช่น แม็คโคร · ท็อปส์/ท็อปแวลู · ซัพพลายอื่นที่มีใบกำกับ
 */
import { computeVatFromGross, normalizeMoney, roundMoney } from "./vat-sales";

export type EntryVatFields = {
  hasVat: boolean;
  vatInput: number;
  vatBase: number;
  vatInvoiceNo: string;
};

/** ผู้ขายที่พบบ่อย — ใบกำกับภาษีซื้อ (hint UI) */
export const COMMON_VAT_VENDORS = [
  "แม็คโคร",
  "ท็อปส์",
  "ท็อปแวลู",
  "บิ๊กซี",
  "โลตัส",
] as const;

/** เสนอภาษีซื้อจากยอดรวม (รวม VAT) · เรท 7% */
export function proposePurchaseVatInput(amountInclusive: number): number {
  return computeVatFromGross(normalizeMoney(amountInclusive)).vatOutput;
}

export function normalizePurchaseVat(
  raw: Partial<EntryVatFields> | undefined,
  amountInclusive = 0,
): EntryVatFields {
  const hasVat = Boolean(raw?.hasVat);
  if (!hasVat) {
    return { hasVat: false, vatInput: 0, vatBase: 0, vatInvoiceNo: "" };
  }
  const proposed = proposePurchaseVatInput(amountInclusive);
  const vatInputRaw = Number(raw?.vatInput);
  const vatInput =
    Number.isFinite(vatInputRaw) && vatInputRaw > 0
      ? normalizeMoney(vatInputRaw)
      : proposed;
  const vatBaseRaw = Number(raw?.vatBase);
  const vatBase =
    Number.isFinite(vatBaseRaw) && vatBaseRaw > 0
      ? normalizeMoney(vatBaseRaw)
      : roundMoney(Math.max(0, normalizeMoney(amountInclusive) - vatInput));
  return {
    hasVat: true,
    vatInput,
    vatBase,
    vatInvoiceNo: String(raw?.vatInvoiceNo || "").trim(),
  };
}

export function parseVatInputStr(raw: string, amountInclusive: number): number {
  const n = Number(String(raw || "").replace(/,/g, ""));
  if (Number.isFinite(n) && n > 0) return normalizeMoney(n);
  return proposePurchaseVatInput(amountInclusive);
}
