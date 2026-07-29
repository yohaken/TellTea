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

/** ชื่อเดือนไทยเต็ม (index 1–12) */
export const THAI_MONTH_FULL = [
  "",
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

/** เดือน YYYY-MM → เช่น กรกฎาคม 2569 */
export function formatThaiMonthKey(monthKey: string): string {
  if (!isMonthKey(monthKey)) return monthKey;
  const [ys, ms] = monthKey.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || m < 1 || m > 12) return monthKey;
  return `${THAI_MONTH_FULL[m]} ${y + 543}`;
}

/** รายการเดือนไทยสำหรับตัวเลือก (ล่าสุดก่อน · นับย้อนหลัง) */
export function listThaiMonthOptions(
  aroundKey?: string,
  back = 24,
  forward = 2,
): { key: string; label: string }[] {
  const base = isMonthKey(aroundKey || "")
    ? (aroundKey as string)
    : (() => {
        const d = new Date();
        const y = d.toLocaleString("en-CA", {
          timeZone: VAT_PERIOD_TZ,
          year: "numeric",
        });
        const m = d.toLocaleString("en-CA", {
          timeZone: VAT_PERIOD_TZ,
          month: "2-digit",
        });
        return `${y}-${m}`;
      })();
  const [ys, ms] = base.split("-").map(Number);
  const out: { key: string; label: string }[] = [];
  for (let delta = forward; delta >= -back; delta -= 1) {
    const { year, month } = addCalendarMonths(ys, ms, delta);
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push({ key, label: formatThaiMonthKey(key) });
  }
  return out;
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
  /**
   * เรทขายเป็น % (เช่น 7 = VAT 7% รวมในราคา)
   * สูตร: ภาษีขาย = gross × outputPct / (100 + outputPct)  ≡  7/107 เมื่อเป็น 7%
   */
  outputPct: number;
  /** สำรอง sync กับของเก่า: outputNum/outputDen */
  outputNum: number;
  outputDen: number;
  /** สัดส่วนประมาณภาษีซื้อจาก GP เทียบภาษีขาย (เช่น 0.3333 = 33.33%) */
  gpOfOutput: number;
  /** คูณลดภาษีซื้อที่ยื่น (เช่น 0.98 = ยื่น 98%) */
  inputClaimFactor: number;
  /** ปัดลงภาษีซื้อ */
  floorInput: boolean;
};

export const DEFAULT_OUTPUT_PCT = 7;
export const DEFAULT_STOREFRONT_REMIT_PCT = 90;

export const DEFAULT_VAT_LOGIC_RATES: VatLogicRates = {
  outputPct: DEFAULT_OUTPUT_PCT,
  outputNum: DEFAULT_OUTPUT_PCT,
  outputDen: 100 + DEFAULT_OUTPUT_PCT,
  gpOfOutput: 1 / 3,
  inputClaimFactor: 0.98,
  floorInput: true,
};

/** เรทขาย % → คู่เศษ/ส่วน (7 → 7/107) */
export function outputPctToFraction(pct: number): { outputNum: number; outputDen: number } {
  const outputPct =
    Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_OUTPUT_PCT;
  return { outputNum: outputPct, outputDen: 100 + outputPct };
}

export function normalizeOutputPct(raw: unknown, fallback = DEFAULT_OUTPUT_PCT): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return fallback;
  return Math.round(n * 100) / 100;
}

export function normalizeRemitPct(raw: unknown, fallback = DEFAULT_STOREFRONT_REMIT_PCT): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return fallback;
  return Math.round(n * 100) / 100;
}

export type VatSegmentKind = "delivery" | "storefront";

/** ย่อยเดลิเวอรี่ */
export type DeliveryChannels = {
  shopee: number;
  grab: number;
  lineman: number;
};

/** ย่อยหน้าร้าน */
export type StorefrontTenders = {
  transfer: number;
  cash: number;
};

export const EMPTY_DELIVERY_CHANNELS: DeliveryChannels = {
  shopee: 0,
  grab: 0,
  lineman: 0,
};

export const EMPTY_STOREFRONT_TENDERS: StorefrontTenders = {
  transfer: 0,
  cash: 0,
};

export function mapDeliveryChannels(raw: unknown): DeliveryChannels {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    shopee: normalizeMoney(o.shopee),
    grab: normalizeMoney(o.grab),
    lineman: normalizeMoney(o.lineman),
  };
}

export function mapStorefrontTenders(raw: unknown): StorefrontTenders {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    transfer: normalizeMoney(o.transfer),
    cash: normalizeMoney(o.cash),
  };
}

export function sumDeliveryChannels(c: DeliveryChannels): number {
  return roundMoney(
    normalizeMoney(c.shopee) + normalizeMoney(c.grab) + normalizeMoney(c.lineman),
  );
}

export function sumStorefrontTenders(t: StorefrontTenders): number {
  return roundMoney(normalizeMoney(t.transfer) + normalizeMoney(t.cash));
}

/**
 * ยอดขายที่ใช้คิด VAT:
 * ถ้าย่อยมียอด > 0 ใช้ผลรวมย่อย · ไม่เช่นนั้นใช้ยอดรวมที่คีย์เอง
 */
export function resolveGrossSales(grossManual: number, partsSum: number): number {
  const parts = normalizeMoney(partsSum);
  if (parts > 0) return parts;
  return normalizeMoney(grossManual);
}

export type VatSegmentInput = {
  kind: VatSegmentKind;
  /** ยอดรวมที่คีย์เอง (ใช้เมื่อยังไม่แยกย่อย) */
  grossManual: number;
  channels: DeliveryChannels;
  tenders: StorefrontTenders;
  /**
   * % นำส่งจริงจากรายได้ (หน้าร้าน default 90 · เดลิเวอรี่ = 100)
   * เฉพาะยอดนำส่งจริงที่นำไปคิด VAT
   */
  remitPct: number;
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
  /** รายได้/ยอดขายรวมก่อนคิด % นำส่ง */
  reportedGross: number;
  /** ยอดนำส่งจริง = reportedGross × remitPct% — ใช้คิด VAT */
  remitAmount: number;
  /** alias ยอดที่คิด VAT (= remitAmount) */
  grossSales: number;
  partsSum: number;
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
  let outputPct = normalizeOutputPct(o.outputPct, 0);
  if (!(outputPct > 0)) {
    // ของเก่า 7/107 → 7%
    if (Number.isFinite(num) && num > 0 && Number.isFinite(den) && den === 100 + num) {
      outputPct = num;
    } else if (Number.isFinite(num) && num > 0 && Number.isFinite(den) && den > num) {
      // ประมาณ % จากเศษ/ส่วน
      outputPct = normalizeOutputPct((num / (den - num)) * 100, DEFAULT_OUTPUT_PCT);
    } else {
      outputPct = DEFAULT_OUTPUT_PCT;
    }
  }
  const frac = outputPctToFraction(outputPct);
  return {
    outputPct,
    outputNum: frac.outputNum,
    outputDen: frac.outputDen,
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

/** ภาษีขายจากยอดรวม: gross × pct/(100+pct) */
export function computeOutputVat(
  grossInclusive: number,
  rates: Pick<VatLogicRates, "outputPct" | "outputNum" | "outputDen"> = DEFAULT_VAT_LOGIC_RATES,
): { vatBase: number; outputVat: number } {
  const gross = normalizeMoney(grossInclusive);
  const mapped = mapVatLogicRates(rates);
  const outputVat = roundMoney(
    (gross * mapped.outputPct) / (100 + mapped.outputPct),
  );
  const vatBase = roundMoney(Math.max(0, gross - outputVat));
  return { vatBase, outputVat };
}

export function computeVatSegment(input: VatSegmentInput): VatSegmentComputed {
  const rates = mapVatLogicRates(input.rates);
  const kind = input.kind === "storefront" ? "storefront" : "delivery";
  const channels = mapDeliveryChannels(input.channels);
  const tenders = mapStorefrontTenders(input.tenders);
  const partsSum =
    kind === "delivery"
      ? sumDeliveryChannels(channels)
      : sumStorefrontTenders(tenders);
  const reportedGross = resolveGrossSales(input.grossManual, partsSum);
  const remitPct =
    kind === "storefront"
      ? normalizeRemitPct(input.remitPct, DEFAULT_STOREFRONT_REMIT_PCT)
      : 100;
  const remitAmount = roundMoney((reportedGross * remitPct) / 100);
  const grossSales = remitAmount;
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
    reportedGross,
    remitAmount,
    grossSales,
    partsSum,
    vatBase,
    outputVat,
    gpEstimate,
    gpVatClaimed,
    ingredientVatClaimed,
    inputVat,
    netVat,
  };
}

export function emptySegment(
  kind: VatSegmentKind = "delivery",
  rates: VatLogicRates = DEFAULT_VAT_LOGIC_RATES,
): VatSegmentState {
  const input: VatSegmentInput = {
    kind,
    grossManual: 0,
    channels: { ...EMPTY_DELIVERY_CHANNELS },
    tenders: { ...EMPTY_STOREFRONT_TENDERS },
    remitPct: kind === "storefront" ? DEFAULT_STOREFRONT_REMIT_PCT : 100,
    gpVat: 0,
    useGpEstimate: true,
    ingredientVat: 0,
    rates: mapVatLogicRates(rates),
  };
  return { ...input, ...computeVatSegment(input) };
}

export function recomputeSegment(seg: VatSegmentInput): VatSegmentState {
  const rates = mapVatLogicRates(seg.rates);
  const kind = seg.kind === "storefront" ? "storefront" : "delivery";
  const input: VatSegmentInput = {
    kind,
    grossManual: normalizeMoney(seg.grossManual),
    channels: mapDeliveryChannels(seg.channels),
    tenders: mapStorefrontTenders(seg.tenders),
    remitPct:
      kind === "storefront"
        ? normalizeRemitPct(seg.remitPct, DEFAULT_STOREFRONT_REMIT_PCT)
        : 100,
    gpVat: normalizeMoney(seg.gpVat),
    useGpEstimate: Boolean(seg.useGpEstimate),
    ingredientVat: normalizeMoney(seg.ingredientVat),
    rates,
  };
  return { ...input, kind: input.kind, ...computeVatSegment(input) };
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

function mapSegment(
  kind: VatSegmentKind,
  raw: unknown,
  fallbackRates: VatLogicRates,
): VatSegmentState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  // รองรับเอกสารเก่าที่เก็บแค่ grossSales
  const legacyGross = normalizeMoney(o.grossSales);
  const grossManual =
    o.grossManual != null ? normalizeMoney(o.grossManual) : legacyGross;
  return recomputeSegment({
    kind,
    grossManual,
    channels: mapDeliveryChannels(o.channels),
    tenders: mapStorefrontTenders(o.tenders),
    remitPct:
      kind === "storefront"
        ? normalizeRemitPct(o.remitPct, DEFAULT_STOREFRONT_REMIT_PCT)
        : 100,
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
  const delivery = mapSegment("delivery", data?.delivery, deliveryRates);
  const storefront = mapSegment("storefront", data?.storefront, storefrontRates);
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

function firestoreErr(e: unknown, action: string): Error {
  const code =
    e && typeof e === "object" && "code" in e
      ? String((e as { code?: string }).code || "")
      : "";
  const msg = e instanceof Error ? e.message : String(e);
  if (code.includes("permission") || /insufficient permissions/i.test(msg)) {
    return new Error(
      `${action}: สิทธิ์ไม่พอ (ต้องเป็นเจ้าของ) — ลองรีเฟรชหรือเข้าใหม่`,
    );
  }
  return e instanceof Error ? e : new Error(msg);
}

export async function loadVatMonthlySettings(): Promise<VatMonthlySettings> {
  try {
    const snap = await getDoc(doc(getDb(), "meta", VAT_MONTHLY_SETTINGS_DOC));
    return mapVatMonthlySettings(
      snap.exists() ? (snap.data() as Partial<VatMonthlySettings>) : undefined,
    );
  } catch (e) {
    throw firestoreErr(e, "โหลดตั้งค่า VAT");
  }
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
  try {
    await setDoc(doc(getDb(), "meta", VAT_MONTHLY_SETTINGS_DOC), next, {
      merge: true,
    });
  } catch (e) {
    throw firestoreErr(e, "บันทึกตั้งค่า VAT");
  }
  return next;
}

export async function loadVatMonthlyReturn(monthKey: string): Promise<VatMonthlyReturn> {
  if (!isMonthKey(monthKey)) throw new Error("เดือนไม่ถูกต้อง");
  try {
    const [snap, settings] = await Promise.all([
      getDoc(doc(getDb(), VAT_MONTHLY_COL, monthKey)),
      loadVatMonthlySettings(),
    ]);
    return mapVatMonthlyReturn(
      monthKey,
      snap.exists() ? (snap.data() as Partial<VatMonthlyReturn>) : undefined,
      settings,
    );
  } catch (e) {
    throw firestoreErr(e, "โหลดยอด VAT เดือน");
  }
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
  try {
    await setDoc(doc(getDb(), VAT_MONTHLY_COL, input.monthKey), docBody, {
      merge: true,
    });
  } catch (e) {
    throw firestoreErr(e, "บันทึกยอด VAT เดือน");
  }
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

  try {
    await saveMonthlyIncome(monthKey, income, by);
  } catch (e) {
    throw firestoreErr(e, "ใส่รายได้ P&L");
  }

  const filed: VatMonthlyReturn = {
    ...current,
    pnlIncome: income,
    status: "filed",
    filedAt: Date.now(),
    filedBy: by,
    updatedAt: Date.now(),
    updatedBy: by,
  };
  try {
    await setDoc(doc(getDb(), VAT_MONTHLY_COL, monthKey), filed, { merge: true });
  } catch (e) {
    throw firestoreErr(e, "ปิดงบ VAT เดือน");
  }
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
  try {
    await setDoc(doc(getDb(), VAT_MONTHLY_COL, monthKey), next, { merge: true });
  } catch (e) {
    throw firestoreErr(e, "ปลดล็อกเดือน VAT");
  }
  return next;
}

export function ratesLabel(rates: VatLogicRates): string {
  const r = mapVatLogicRates(rates);
  return `${r.outputPct}%`;
}

export function gpRatePercent(rates: VatLogicRates): string {
  return `${roundMoney(rates.gpOfOutput * 100)}%`;
}

export { bangkokMonthKey, isMonthKey, normalizeMoney, roundMoney };
