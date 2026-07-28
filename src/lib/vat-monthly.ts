/**
 * VAT รายเดือน (Play-Safe) — เจ้าของเท่านั้น
 *
 * ยอดขายใส่ครั้งเดียวสิ้นเดือน · แยก Delivery / หน้าร้าน
 * ภาษีขาย = ยอดรวม × num/den (default 7/107)
 * ภาษีซื้อ = บิล GP (+ ประมาณ ~1/3 ภาษีขาย) + บิลซื้อวัตถุดิบ · ปัดลง/claim factor
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { saveMonthlyIncome } from "./pnl";
import {
  bangkokMonthKey,
  isMonthKey,
  normalizeMoney,
  roundMoney,
} from "./vat-sales";

export const VAT_MONTHLY_COL = "vatMonthlyReturns";
export const VAT_MONTHLY_SETTINGS_DOC = "vatMonthlySettings";

/** โซนเวลารอบ VAT — ตรึง Asia/Bangkok เสมอ */
export const VAT_PERIOD_TZ = "Asia/Bangkok";
/** วันเริ่มรอบในเดือน (default = วันที่ 1 เวลา 00:00) */
export const DEFAULT_PERIOD_START_DAY = 1;

/** ปัดลงเป็นสตางค์ — ใช้ฝั่งภาษีซื้อ (play-safe) */
export function floorMoney(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 100 + Number.EPSILON) / 100;
}

/** clamp วันเริ่มรอบ 1–28 (กันเดือนกุมภาพันธ์) */
export function normalizePeriodStartDay(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PERIOD_START_DAY;
  return Math.min(28, Math.max(1, Math.floor(n)));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function addCalendarMonths(
  year: number,
  month1to12: number,
  delta: number,
): { year: number; month: number } {
  const idx = year * 12 + (month1to12 - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** วันที่แบบ d/M/พ.ศ. เช่น 1/7/2569 */
export function formatThaiDateKey(dateKey: string): string {
  if (!isMonthKey(dateKey) && !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [ys, ms, ds] = dateKey.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds || "1");
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateKey;
  return `${d}/${m}/${y + 543}`;
}

export type VatPeriodBoundary = {
  monthKey: string;
  startDay: number;
  timeZone: string;
  /** รวม — เริ่ม 00:00 */
  startDateKey: string;
  /** ไม่รวม — 00:00 ของวันถัดจากรอบ */
  endExclusiveDateKey: string;
  /** รวม — วันสุดท้ายของรอบ */
  endInclusiveDateKey: string;
  /** เช่น 00:00 น. 1/7/2569 → 00:00 น. 1/8/2569 (ไม่รวม) */
  labelExclusive: string;
  /** เช่น 00:00 น. 1/7/2569 → 23:59 น. 31/7/2569 */
  labelInclusive: string;
};

/**
 * ขอบเขตรอบ VAT ของ monthKey (YYYY-MM)
 * เริ่ม 00:00 น. วันที่ startDay · จบก่อน 00:00 น. ของรอบถัดไป
 * โซนเวลา: Asia/Bangkok
 */
export function getVatPeriodBoundary(
  monthKey: string,
  startDay: number = DEFAULT_PERIOD_START_DAY,
): VatPeriodBoundary {
  if (!isMonthKey(monthKey)) {
    throw new Error("เดือนไม่ถูกต้อง");
  }
  const day = normalizePeriodStartDay(startDay);
  const [ys, ms] = monthKey.split("-").map(Number);
  const dim = daysInMonth(ys, ms);
  const startD = Math.min(day, dim);
  const startDateKey = `${ys}-${pad2(ms)}-${pad2(startD)}`;

  const next = addCalendarMonths(ys, ms, 1);
  const nextDim = daysInMonth(next.year, next.month);
  const nextStartD = Math.min(day, nextDim);
  const endExclusiveDateKey = `${next.year}-${pad2(next.month)}-${pad2(nextStartD)}`;

  // วันสุดท้ายรวม = วันปฏิทินก่อน endExclusive
  const endInclusiveDateKey = (() => {
    const [ey, em, ed] = endExclusiveDateKey.split("-").map(Number);
    if (ed > 1) return `${ey}-${pad2(em)}-${pad2(ed - 1)}`;
    const prev = addCalendarMonths(ey, em, -1);
    return `${prev.year}-${pad2(prev.month)}-${pad2(daysInMonth(prev.year, prev.month))}`;
  })();

  const startTh = formatThaiDateKey(startDateKey);
  const endExTh = formatThaiDateKey(endExclusiveDateKey);
  const endIncTh = formatThaiDateKey(endInclusiveDateKey);

  return {
    monthKey,
    startDay: day,
    timeZone: VAT_PERIOD_TZ,
    startDateKey,
    endExclusiveDateKey,
    endInclusiveDateKey,
    labelExclusive: `00:00 น. ${startTh} → 00:00 น. ${endExTh} (ไม่รวม)`,
    labelInclusive: `00:00 น. ${startTh} → 23:59 น. ${endIncTh}`,
  };
}

export type VatLogicRates = {
  /** ภาษีขาย: gross × outputNum / outputDen */
  outputNum: number;
  outputDen: number;
  /** สัดส่วนประมาณภาษีซื้อจาก GP เทียบภาษีขาย (เช่น 1/3) */
  gpOfOutput: number;
  /** คูณลดภาษีซื้อที่ยื่น (เช่น 0.98 = ยื่น 98%) */
  inputClaimFactor: number;
  /** ปัดลงภาษีซื้อ */
  floorInput: boolean;
};

export const DEFAULT_VAT_LOGIC_RATES: VatLogicRates = {
  outputNum: 7,
  outputDen: 107,
  gpOfOutput: 1 / 3,
  inputClaimFactor: 0.98,
  floorInput: true,
};

export type VatSegmentKind = "delivery" | "storefront";

export type VatSegmentInput = {
  /** ยอดขายรวมรวม VAT (gross inclusive) */
  grossSales: number;
  /**
   * ภาษีซื้อจากบิล GP สรุปรายเดือน
   * ถ้าวาง 0 และ useGpEstimate=true → ใช้ประมาณ gpOfOutput × ภาษีขาย
   */
  gpVat: number;
  /** ใช้ประมาณ GP จากเรทแทนยอดที่คีย์ */
  useGpEstimate: boolean;
  /** ภาษีซื้อจากบิลวัตถุดิบจริง */
  ingredientVat: number;
  rates: VatLogicRates;
};

export type VatSegmentComputed = {
  vatBase: number;
  outputVat: number;
  gpEstimate: number;
  gpVatClaimed: number;
  ingredientVatClaimed: number;
  inputVat: number;
  netVat: number;
};

export type VatSegmentState = VatSegmentInput & VatSegmentComputed;

export type VatMonthlyStatus = "draft" | "saved" | "filed";

export type VatMonthlyReturn = {
  monthKey: string;
  delivery: VatSegmentState;
  storefront: VatSegmentState;
  totals: {
    grossSales: number;
    vatBase: number;
    outputVat: number;
    inputVat: number;
    netVat: number;
  };
  status: VatMonthlyStatus;
  note: string;
  /** รายได้ที่ส่งเข้า P&L (ฐานก่อน VAT เป็นค่าเริ่มต้น) */
  pnlIncome: number;
  pnlIncomeMode: "exVat" | "incVat";
  filedAt: number;
  filedBy: string;
  updatedAt: number;
  updatedBy: string;
};

export type VatMonthlySettings = {
  deliveryRates: VatLogicRates;
  storefrontRates: VatLogicRates;
  pnlIncomeMode: "exVat" | "incVat";
  /**
   * วันเริ่มรอบในแต่ละเดือน (1–28) เวลา 00:00 น. Asia/Bangkok
   * default = 1 → เช่น 00:00 น. 1/7/2569 → 00:00 น. 1/8/2569 (ไม่รวม)
   */
  periodStartDay: number;
  updatedAt: number;
  updatedBy: string;
};

export function mapVatLogicRates(raw: unknown): VatLogicRates {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = Number(o.outputNum);
  const den = Number(o.outputDen);
  const gp = Number(o.gpOfOutput);
  const claim = Number(o.inputClaimFactor);
  return {
    outputNum:
      Number.isFinite(num) && num > 0 ? num : DEFAULT_VAT_LOGIC_RATES.outputNum,
    outputDen:
      Number.isFinite(den) && den > 0 ? den : DEFAULT_VAT_LOGIC_RATES.outputDen,
    gpOfOutput:
      Number.isFinite(gp) && gp >= 0 && gp <= 1
        ? gp
        : DEFAULT_VAT_LOGIC_RATES.gpOfOutput,
    inputClaimFactor:
      Number.isFinite(claim) && claim > 0 && claim <= 1
        ? claim
        : DEFAULT_VAT_LOGIC_RATES.inputClaimFactor,
    floorInput: o.floorInput !== false,
  };
}

function applyMoneyMode(n: number, floor: boolean): number {
  return floor ? floorMoney(n) : roundMoney(n);
}

/** ภาษีขายจากยอดรวม: gross × num/den */
export function computeOutputVat(
  grossInclusive: number,
  rates: Pick<VatLogicRates, "outputNum" | "outputDen"> = DEFAULT_VAT_LOGIC_RATES,
): { vatBase: number; outputVat: number } {
  const gross = normalizeMoney(grossInclusive);
  const den = rates.outputDen > 0 ? rates.outputDen : 107;
  const num = rates.outputNum > 0 ? rates.outputNum : 7;
  const outputVat = roundMoney((gross * num) / den);
  const vatBase = roundMoney(Math.max(0, gross - outputVat));
  return { vatBase, outputVat };
}

export function computeVatSegment(input: VatSegmentInput): VatSegmentComputed {
  const rates = mapVatLogicRates(input.rates);
  const grossSales = normalizeMoney(input.grossSales);
  const { vatBase, outputVat } = computeOutputVat(grossSales, rates);

  const gpEstimate = applyMoneyMode(outputVat * rates.gpOfOutput, rates.floorInput);
  const gpRaw = input.useGpEstimate ? gpEstimate : normalizeMoney(input.gpVat);
  const gpVatClaimed = applyMoneyMode(
    gpRaw * rates.inputClaimFactor,
    rates.floorInput,
  );
  const ingredientVatClaimed = applyMoneyMode(
    normalizeMoney(input.ingredientVat) * rates.inputClaimFactor,
    rates.floorInput,
  );
  const inputVat = roundMoney(gpVatClaimed + ingredientVatClaimed);
  const netVat = roundMoney(outputVat - inputVat);

  return {
    vatBase,
    outputVat,
    gpEstimate,
    gpVatClaimed,
    ingredientVatClaimed,
    inputVat,
    netVat,
  };
}

export function emptySegment(rates: VatLogicRates = DEFAULT_VAT_LOGIC_RATES): VatSegmentState {
  const input: VatSegmentInput = {
    grossSales: 0,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: mapVatLogicRates(rates),
  };
  return { ...input, ...computeVatSegment(input) };
}

export function recomputeSegment(seg: VatSegmentInput): VatSegmentState {
  const rates = mapVatLogicRates(seg.rates);
  const input: VatSegmentInput = {
    grossSales: normalizeMoney(seg.grossSales),
    gpVat: normalizeMoney(seg.gpVat),
    useGpEstimate: Boolean(seg.useGpEstimate),
    ingredientVat: normalizeMoney(seg.ingredientVat),
    rates,
  };
  return { ...input, ...computeVatSegment(input) };
}

export function sumMonthlyTotals(
  delivery: VatSegmentComputed,
  storefront: VatSegmentComputed,
  deliveryGross: number,
  storefrontGross: number,
) {
  return {
    grossSales: roundMoney(
      normalizeMoney(deliveryGross) + normalizeMoney(storefrontGross),
    ),
    vatBase: roundMoney(delivery.vatBase + storefront.vatBase),
    outputVat: roundMoney(delivery.outputVat + storefront.outputVat),
    inputVat: roundMoney(delivery.inputVat + storefront.inputVat),
    netVat: roundMoney(delivery.netVat + storefront.netVat),
  };
}

export function proposePnlIncome(
  totals: { vatBase: number; grossSales: number },
  mode: "exVat" | "incVat",
): number {
  return mode === "incVat" ? totals.grossSales : totals.vatBase;
}

function mapSegment(raw: unknown, fallbackRates: VatLogicRates): VatSegmentState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return recomputeSegment({
    grossSales: normalizeMoney(o.grossSales),
    gpVat: normalizeMoney(o.gpVat),
    useGpEstimate: o.useGpEstimate !== false,
    ingredientVat: normalizeMoney(o.ingredientVat),
    rates: mapVatLogicRates(o.rates ?? fallbackRates),
  });
}

export function mapVatMonthlyReturn(
  monthKey: string,
  data: Partial<VatMonthlyReturn> | undefined,
  settings?: VatMonthlySettings,
): VatMonthlyReturn {
  const deliveryRates = settings?.deliveryRates || DEFAULT_VAT_LOGIC_RATES;
  const storefrontRates = settings?.storefrontRates || DEFAULT_VAT_LOGIC_RATES;
  const delivery = mapSegment(data?.delivery, deliveryRates);
  const storefront = mapSegment(data?.storefront, storefrontRates);
  const totals = sumMonthlyTotals(
    delivery,
    storefront,
    delivery.grossSales,
    storefront.grossSales,
  );
  const mode = data?.pnlIncomeMode === "incVat" ? "incVat" : settings?.pnlIncomeMode === "incVat" ? "incVat" : "exVat";
  const status =
    data?.status === "filed" || data?.status === "saved" || data?.status === "draft"
      ? data.status
      : "draft";
  return {
    monthKey,
    delivery,
    storefront,
    totals,
    status,
    note: String(data?.note || ""),
    pnlIncome:
      data?.pnlIncome != null && Number.isFinite(Number(data.pnlIncome))
        ? normalizeMoney(data.pnlIncome)
        : proposePnlIncome(totals, mode),
    pnlIncomeMode: mode,
    filedAt: Number(data?.filedAt) || 0,
    filedBy: String(data?.filedBy || ""),
    updatedAt: Number(data?.updatedAt) || 0,
    updatedBy: String(data?.updatedBy || ""),
  };
}

export function mapVatMonthlySettings(
  data: Partial<VatMonthlySettings> | undefined,
): VatMonthlySettings {
  return {
    deliveryRates: mapVatLogicRates(data?.deliveryRates),
    storefrontRates: mapVatLogicRates(data?.storefrontRates),
    pnlIncomeMode: data?.pnlIncomeMode === "incVat" ? "incVat" : "exVat",
    periodStartDay: normalizePeriodStartDay(
      data?.periodStartDay ?? DEFAULT_PERIOD_START_DAY,
    ),
    updatedAt: Number(data?.updatedAt) || 0,
    updatedBy: String(data?.updatedBy || ""),
  };
}

export async function loadVatMonthlySettings(): Promise<VatMonthlySettings> {
  const snap = await getDoc(doc(getDb(), "meta", VAT_MONTHLY_SETTINGS_DOC));
  return mapVatMonthlySettings(
    snap.exists() ? (snap.data() as Partial<VatMonthlySettings>) : undefined,
  );
}

export async function saveVatMonthlySettings(
  patch: Partial<VatMonthlySettings>,
  by: string,
): Promise<VatMonthlySettings> {
  const current = await loadVatMonthlySettings();
  const next = mapVatMonthlySettings({
    ...current,
    ...patch,
    deliveryRates: patch.deliveryRates
      ? mapVatLogicRates(patch.deliveryRates)
      : current.deliveryRates,
    storefrontRates: patch.storefrontRates
      ? mapVatLogicRates(patch.storefrontRates)
      : current.storefrontRates,
    periodStartDay:
      patch.periodStartDay != null
        ? normalizePeriodStartDay(patch.periodStartDay)
        : current.periodStartDay,
    updatedAt: Date.now(),
    updatedBy: by,
  });
  await setDoc(doc(getDb(), "meta", VAT_MONTHLY_SETTINGS_DOC), next, { merge: true });
  return next;
}

export async function loadVatMonthlyReturn(monthKey: string): Promise<VatMonthlyReturn> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const [snap, settings] = await Promise.all([
    getDoc(doc(getDb(), VAT_MONTHLY_COL, monthKey)),
    loadVatMonthlySettings(),
  ]);
  return mapVatMonthlyReturn(
    monthKey,
    snap.exists() ? (snap.data() as Partial<VatMonthlyReturn>) : undefined,
    settings,
  );
}

export type VatMonthlySaveInput = {
  monthKey: string;
  delivery: VatSegmentInput;
  storefront: VatSegmentInput;
  note?: string;
  pnlIncomeMode?: "exVat" | "incVat";
  pnlIncome?: number;
  status?: "draft" | "saved";
};

export async function saveVatMonthlyReturn(
  input: VatMonthlySaveInput,
  by: string,
): Promise<VatMonthlyReturn> {
  if (!isMonthKey(input.monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const delivery = recomputeSegment(input.delivery);
  const storefront = recomputeSegment(input.storefront);
  const totals = sumMonthlyTotals(
    delivery,
    storefront,
    delivery.grossSales,
    storefront.grossSales,
  );
  const mode = input.pnlIncomeMode === "incVat" ? "incVat" : "exVat";
  const existing = await getDoc(doc(getDb(), VAT_MONTHLY_COL, input.monthKey));
  const prev = existing.exists()
    ? (existing.data() as Partial<VatMonthlyReturn>)
    : undefined;
  if (prev?.status === "filed") {
    throw new Error("เดือนนี้ยื่น/ปิดแล้ว — ปลดล็อกก่อนแก้");
  }
  const pnlIncome =
    input.pnlIncome != null && Number.isFinite(Number(input.pnlIncome))
      ? normalizeMoney(input.pnlIncome)
      : proposePnlIncome(totals, mode);
  const docBody: VatMonthlyReturn = {
    monthKey: input.monthKey,
    delivery,
    storefront,
    totals,
    status: input.status === "draft" ? "draft" : "saved",
    note: String(input.note || "").trim(),
    pnlIncome,
    pnlIncomeMode: mode,
    filedAt: 0,
    filedBy: "",
    updatedAt: Date.now(),
    updatedBy: by,
  };
  await setDoc(doc(getDb(), VAT_MONTHLY_COL, input.monthKey), docBody, { merge: true });
  return docBody;
}

/** ปิดเดือน → ใส่รายได้เข้า monthlyIncome (P&L) */
export async function fileVatMonthlyReturn(
  monthKey: string,
  by: string,
  opts?: { forceIncome?: number },
): Promise<VatMonthlyReturn> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const current = await loadVatMonthlyReturn(monthKey);
  if (current.totals.grossSales <= 0) {
    throw new Error("ยังไม่มียอดขายในเดือนนี้");
  }
  const income =
    opts?.forceIncome != null
      ? normalizeMoney(opts.forceIncome)
      : current.pnlIncome || proposePnlIncome(current.totals, current.pnlIncomeMode);
  if (!Number.isFinite(income) || income < 0) {
    throw new Error("ยอดรายได้ไม่ถูกต้อง");
  }

  await saveMonthlyIncome(monthKey, income, by);

  const filed: VatMonthlyReturn = {
    ...current,
    pnlIncome: income,
    status: "filed",
    filedAt: Date.now(),
    filedBy: by,
    updatedAt: Date.now(),
    updatedBy: by,
  };
  await setDoc(doc(getDb(), VAT_MONTHLY_COL, monthKey), filed, { merge: true });
  return filed;
}

export async function unlockVatMonthlyReturn(
  monthKey: string,
  by: string,
): Promise<VatMonthlyReturn> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  const current = await loadVatMonthlyReturn(monthKey);
  const next: VatMonthlyReturn = {
    ...current,
    status: "saved",
    filedAt: 0,
    filedBy: "",
    updatedAt: Date.now(),
    updatedBy: by,
  };
  await setDoc(doc(getDb(), VAT_MONTHLY_COL, monthKey), next, { merge: true });
  return next;
}

export function ratesLabel(rates: VatLogicRates): string {
  return `${rates.outputNum}/${rates.outputDen}`;
}

export function gpRatePercent(rates: VatLogicRates): string {
  return `${roundMoney(rates.gpOfOutput * 100)}%`;
}

export { bangkokMonthKey, isMonthKey, normalizeMoney, roundMoney };
