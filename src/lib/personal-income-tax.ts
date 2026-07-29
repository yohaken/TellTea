/**
 * ภาษีเงินได้บุคคลธรรมดา (ภ.ง.ด.) — ขั้นบันไดตามกฎหมายปัจจุบัน
 * ค่าลดหย่อนผู้มีเงินได้ default 60,000 · แก้ได้
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { normalizeMoney, roundMoney } from "./vat-sales";

export const PERSONAL_TAX_SETTINGS_DOC = "personalTaxSettings";

/** ค่าลดหย่อนผู้มีเงินได้ — หลัก 60,000 บาท */
export const DEFAULT_PERSONAL_ALLOWANCE = 60_000;

/**
 * ขั้นบันไดภาษีเงินได้บุคคลธรรมดา (เงินได้สุทธิหลังหักค่าลดหย่อน)
 * ตามอัตราที่ใช้ทั่วไปในระบบสรรพากร
 */
export const THAI_PIT_BRACKETS: ReadonlyArray<{
  upTo: number; // inclusive ceiling; Infinity = ชั้นบนสุด
  rate: number; // 0–1
  label: string;
}> = [
  { upTo: 150_000, rate: 0, label: "0 – 150,000" },
  { upTo: 300_000, rate: 0.05, label: "150,001 – 300,000" },
  { upTo: 500_000, rate: 0.1, label: "300,001 – 500,000" },
  { upTo: 750_000, rate: 0.15, label: "500,001 – 750,000" },
  { upTo: 1_000_000, rate: 0.2, label: "750,001 – 1,000,000" },
  { upTo: 2_000_000, rate: 0.25, label: "1,000,001 – 2,000,000" },
  { upTo: 5_000_000, rate: 0.3, label: "2,000,001 – 5,000,000" },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.35, label: "5,000,001 ขึ้นไป" },
];

export type PersonalTaxSettings = {
  /** ค่าลดหย่อนผู้มีเงินได้ */
  personalAllowance: number;
  /** ค่าลดหย่อน/รายการอื่นรวม (แก้เองได้) */
  otherDeductions: number;
  note: string;
  updatedAt: number;
  updatedBy: string;
};

export function mapPersonalTaxSettings(
  raw: Partial<PersonalTaxSettings> | undefined,
): PersonalTaxSettings {
  const allowance = Number(raw?.personalAllowance);
  const other = Number(raw?.otherDeductions);
  return {
    personalAllowance:
      Number.isFinite(allowance) && allowance >= 0
        ? normalizeMoney(allowance)
        : DEFAULT_PERSONAL_ALLOWANCE,
    otherDeductions:
      Number.isFinite(other) && other >= 0 ? normalizeMoney(other) : 0,
    note: String(raw?.note || ""),
    updatedAt: Number(raw?.updatedAt) || 0,
    updatedBy: String(raw?.updatedBy || ""),
  };
}

export async function loadPersonalTaxSettings(): Promise<PersonalTaxSettings> {
  try {
    const snap = await getDoc(doc(getDb(), "meta", PERSONAL_TAX_SETTINGS_DOC));
    return mapPersonalTaxSettings(
      snap.exists() ? (snap.data() as Partial<PersonalTaxSettings>) : undefined,
    );
  } catch {
    return mapPersonalTaxSettings(undefined);
  }
}

export async function savePersonalTaxSettings(
  patch: Partial<Pick<PersonalTaxSettings, "personalAllowance" | "otherDeductions" | "note">>,
  by: string,
): Promise<PersonalTaxSettings> {
  const current = await loadPersonalTaxSettings();
  const next = mapPersonalTaxSettings({
    ...current,
    ...patch,
    updatedAt: Date.now(),
    updatedBy: by,
  });
  await setDoc(doc(getDb(), "meta", PERSONAL_TAX_SETTINGS_DOC), next, {
    merge: true,
  });
  return next;
}

export type BracketSlice = {
  label: string;
  rate: number;
  bandAmount: number;
  tax: number;
};

export type PersonalTaxResult = {
  profit: number;
  personalAllowance: number;
  otherDeductions: number;
  totalDeductions: number;
  taxable: number;
  tax: number;
  slices: BracketSlice[];
};

/** คำนวณภาษีเงินได้จากกำไรปี − ค่าลดหย่อน ตามขั้นบันได */
export function computePersonalIncomeTax(
  profit: number,
  settings: Pick<PersonalTaxSettings, "personalAllowance" | "otherDeductions">,
): PersonalTaxResult {
  const personalAllowance = Math.max(0, normalizeMoney(settings.personalAllowance));
  const otherDeductions = Math.max(0, normalizeMoney(settings.otherDeductions));
  const totalDeductions = roundMoney(personalAllowance + otherDeductions);
  const taxable = roundMoney(Math.max(0, normalizeMoney(profit) - totalDeductions));

  const slices: BracketSlice[] = [];
  let remaining = taxable;
  let lower = 0;
  let tax = 0;

  for (const b of THAI_PIT_BRACKETS) {
    const span = Number.isFinite(b.upTo) ? b.upTo - lower : remaining;
    const bandAmount = roundMoney(Math.max(0, Math.min(remaining, span)));
    const bandTax = roundMoney(bandAmount * b.rate);
    slices.push({
      label: b.label,
      rate: b.rate,
      bandAmount,
      tax: bandTax,
    });
    tax = roundMoney(tax + bandTax);
    remaining = roundMoney(remaining - bandAmount);
    lower = b.upTo;
    if (remaining <= 0) break;
  }

  return {
    profit: normalizeMoney(profit),
    personalAllowance,
    otherDeductions,
    totalDeductions,
    taxable,
    tax,
    slices,
  };
}

/**
 * ประมาณต้นทุน GP ก้อนเดลิเวอรี่ (ก่อน VAT)
 * จากภาษีซื้อ GP → ยอดก่อน VAT ตามเรทขาย %
 */
export function proposeDeliveryGpDeduct(input: {
  gpVatClaimed: number;
  gpEstimate: number;
  outputPct?: number;
}): number {
  const vatBaht = normalizeMoney(
    input.gpVatClaimed > 0 ? input.gpVatClaimed : input.gpEstimate,
  );
  if (vatBaht <= 0) return 0;
  const pct =
    Number.isFinite(input.outputPct) && (input.outputPct as number) > 0
      ? (input.outputPct as number)
      : 7;
  return roundMoney((vatBaht * 100) / pct);
}

export type IncomeBridge = {
  deliveryGross: number;
  storefrontGross: number;
  grossTotal: number;
  gpDeduct: number;
  /** รายได้สุทธิที่ควรใส่ P&L */
  pnlIncome: number;
};

/** สะพานรายได้ → P&L: แยกร้าน/ส่ง แล้วหัก GP ก้อนเดลิเวอรี่ */
export function buildIncomeBridge(input: {
  deliveryVatBase: number;
  deliveryGrossSales: number;
  storefrontVatBase: number;
  storefrontGrossSales: number;
  mode: "exVat" | "incVat";
  gpDeduct: number;
}): IncomeBridge {
  const deliveryGross =
    input.mode === "incVat"
      ? normalizeMoney(input.deliveryGrossSales)
      : normalizeMoney(input.deliveryVatBase);
  const storefrontGross =
    input.mode === "incVat"
      ? normalizeMoney(input.storefrontGrossSales)
      : normalizeMoney(input.storefrontVatBase);
  const grossTotal = roundMoney(deliveryGross + storefrontGross);
  const gpDeduct = Math.max(0, normalizeMoney(input.gpDeduct));
  const pnlIncome = roundMoney(Math.max(0, grossTotal - gpDeduct));
  return { deliveryGross, storefrontGross, grossTotal, gpDeduct, pnlIncome };
}
