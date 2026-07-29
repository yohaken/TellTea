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

/**
 * โหมดหัก GP ต่อช่องทาง
 * - transfer: ใส่ยอดโอนหลัง → คชจ. = รายได้ − โอนหลัง (แนะนำ)
 * - pct: ใส่เรท % → คชจ. = รายได้ × %
 * - amount: ใส่ยอดหัก fix
 */
export type GpDeductMode = "pct" | "amount" | "transfer";

/** เรท % คงที่เริ่มต้น — ใช้หาค่าเฉลี่ยหลายเดือน (ต่อช่องทาง) */
export const DEFAULT_GP_DEDUCT_PCT = 30;

/** ช่องทางหัก GP — เดลิเวอรี่แยกรายช่อง · หน้าร้านแยกต่างหาก */
export type GpChannelKey = "shopee" | "grab" | "lineman" | "storefront";

export const GP_DELIVERY_CHANNEL_KEYS = [
  "shopee",
  "grab",
  "lineman",
] as const satisfies ReadonlyArray<Exclude<GpChannelKey, "storefront">>;

export const GP_CHANNEL_LABELS: Record<GpChannelKey, string> = {
  shopee: "ShopeeFood",
  grab: "Grab",
  lineman: "LINE MAN",
  storefront: "หน้าร้าน",
};

export type GpChannelDeduct = {
  mode: GpDeductMode;
  pct: number;
  /** คชจ. GP (บาท) — ใส่เอง / จากนำเข้า · แยกจากยอดโอนจริง */
  amount: number;
  /** ยอดโอนจริงถึงร้าน (บาท) */
  netTransfer: number;
  /**
   * ภาษีซื้อ GP จากใบกำกับ (บาท) — ว่าง/0 = ประมาณคชจ.×7/107
   */
  gpVatOverride: number;
};

export type GpByChannel = Record<GpChannelKey, GpChannelDeduct>;

export type GpChannelRow = {
  key: GpChannelKey;
  label: string;
  /** @deprecated อ้างอิงยอดขายแพลตฟอร์ม — ตาราง GP ไม่โชว์แล้ว */
  gross: number;
  /** ยอดโอนจริงถึงร้าน */
  netTransfer: number;
  /** คชจ. GP (แยกใส่ · ไม่ = รายได้−โอน ในตารางนี้) */
  deduct: number;
  /** เรทประมาณ คชจ./(คชจ.+โอน) ถ้ามีทั้งคู่ */
  impliedPct: number;
  /** ภาษีซื้อ GP (บาท) — จากใบกำกับ หรือประมาณจากคชจ.×7/107 */
  gpVat: number;
  settings: GpChannelDeduct;
};

export type IncomeBridge = {
  /**
   * รวมยอดโอนจริงเดลิเวอรี่ (SF+GB+LM) — ไม่รวมหน้าร้าน
   * (ชื่อ deliveryGross คงไว้ให้โค้ดเก่า · ความหมาย = โอนจริง)
   */
  deliveryGross: number;
  /** หน้าร้านแยก — ยอดจริงถึงร้าน */
  storefrontGross: number;
  /** รวมถึงร้าน = โอนเดลิเวอรี่ + หน้าร้าน */
  grossTotal: number;
  /** รวมคชจ. GP (ติดตามภาษีซื้อ · ไม่หักซ้ำจากยอดโอนจริงตอนใส่ P&L) */
  gpDeduct: number;
  /** รวมภาษีซื้อ GP เดลิเวอรี่ (Shopee+Grab+LM) → ใส่ภาษีซื้อ VAT */
  deliveryGpVat: number;
  /** ภาษีซื้อ GP หน้าร้าน (ปกติ 0) */
  storefrontGpVat: number;
  /** deliveryGpVat + storefrontGpVat */
  gpVatTotal: number;
  /** เรทเฉลี่ย คชจ./(คชจ.+โอน) เดลิเวอรี่ */
  weightedAvgPct: number;
  /** รายได้สุทธิที่ควรใส่ P&L = ยอดถึงร้าน (โอนจริง+หน้าร้าน) */
  pnlIncome: number;
  /** แถวรายช่องทาง (เดลิเวอรี่ + หน้าร้าน) */
  channelRows: GpChannelRow[];
  gpByChannel: GpByChannel;
  /**
   * @deprecated ค่าเฉลี่ย/มรดก — UI ใช้รายช่องทาง
   * คงไว้ให้เซฟเก่าอ่านได้ (transfer รายงานเป็น amount)
   */
  gpDeductMode: "pct" | "amount";
  gpDeductPct: number;
};

export function emptyGpChannelDeduct(
  pct = 0,
  mode: GpDeductMode = "pct",
): GpChannelDeduct {
  return {
    mode,
    pct: Math.min(100, Math.max(0, Number(pct) || 0)),
    amount: 0,
    netTransfer: 0,
    gpVatOverride: 0,
  };
}

/**
 * ภาษีซื้อประมาณจากค่า GP (คชจ.เป็นยอดรวม VAT / เงินแพลตฟอร์ม)
 * ใช้ × pct/(100+pct) เสมอ — ตาราง GP หาคชจ.จากเงินเข้าร้าน ไม่หัก 7% ก่อน
 * พารามิเตอร์ incomeMode คงไว้ให้เรียกเก่า — ไม่เปลี่ยนสูตรแล้ว
 */
export function gpVatFromFee(
  fee: number,
  _incomeMode: "exVat" | "incVat" = "incVat",
  outputPct = 7,
): number {
  const f = Math.max(0, normalizeMoney(fee));
  if (f <= 0) return 0;
  const pct =
    Number.isFinite(outputPct) && outputPct > 0 ? outputPct : 7;
  return roundMoney((f * pct) / (100 + pct));
}

/**
 * ค่าเริ่ม: เดลิเวอรี่รอใส่ยอดโอนจริง (ไม่ประมาณก้อน)
 * หน้าร้านไม่หัก (0%)
 */
export function defaultGpByChannel(
  deliveryPct = 0,
  deliveryMode: GpDeductMode = "transfer",
): GpByChannel {
  const d = emptyGpChannelDeduct(deliveryPct, deliveryMode);
  return {
    shopee: { ...d },
    grab: { ...d },
    lineman: { ...d },
    storefront: emptyGpChannelDeduct(0, "pct"),
  };
}

export function mapGpDeductMode(raw: unknown, fallback: GpDeductMode = "pct"): GpDeductMode {
  if (raw === "amount" || raw === "transfer" || raw === "pct") return raw;
  return fallback;
}

export function mapGpChannelDeduct(
  raw: unknown,
  fallback: GpChannelDeduct = emptyGpChannelDeduct(DEFAULT_GP_DEDUCT_PCT),
): GpChannelDeduct {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = mapGpDeductMode(o.mode, fallback.mode);
  const pctRaw = Number(o.pct);
  const pct =
    Number.isFinite(pctRaw) && pctRaw >= 0 && pctRaw <= 100
      ? Math.round(pctRaw * 100) / 100
      : fallback.pct;
  const amtRaw = Number(o.amount);
  const amount =
    Number.isFinite(amtRaw) && amtRaw >= 0
      ? normalizeMoney(amtRaw)
      : fallback.amount;
  const netRaw = Number(o.netTransfer);
  const netTransfer =
    Number.isFinite(netRaw) && netRaw >= 0
      ? normalizeMoney(netRaw)
      : fallback.netTransfer;
  const vatRaw = Number(o.gpVatOverride);
  const gpVatOverride =
    Number.isFinite(vatRaw) && vatRaw >= 0
      ? normalizeMoney(vatRaw)
      : fallback.gpVatOverride;
  return { mode, pct, amount, netTransfer, gpVatOverride };
}

/**
 * อ่านแผนที่หัก GP รายช่องทาง
 * ถ้าไม่มี → สร้างจาก legacy (โหมด/% ก้อนเดียว) ใส่ทุกช่องทางเดลิเวอรี่ · หน้าร้าน 0
 */
export function mapGpByChannel(
  raw: unknown,
  legacy?: {
    mode?: GpDeductMode;
    pct?: number;
    amount?: number;
  },
): GpByChannel {
  const legacyMode = mapGpDeductMode(legacy?.mode, "pct");
  const legacyPct =
    Number.isFinite(Number(legacy?.pct)) && Number(legacy?.pct) > 0
      ? Number(legacy?.pct)
      : DEFAULT_GP_DEDUCT_PCT;
  const base = defaultGpByChannel(legacyPct, legacyMode === "transfer" ? "pct" : legacyMode);
  if (legacyMode === "amount" && Number(legacy?.amount) > 0) {
    // มรดกยอดก้อน — ใส่ Grab เป็นที่เก็บหลัก (แยกมือทีหลังได้)
    base.grab = {
      mode: "amount",
      pct: legacyPct,
      amount: normalizeMoney(Number(legacy?.amount)),
      netTransfer: 0,
      gpVatOverride: 0,
    };
    base.shopee = emptyGpChannelDeduct(0, "pct");
    base.lineman = emptyGpChannelDeduct(0, "pct");
  }
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    shopee: mapGpChannelDeduct(o.shopee, base.shopee),
    grab: mapGpChannelDeduct(o.grab, base.grab),
    lineman: mapGpChannelDeduct(o.lineman, base.lineman),
    storefront: mapGpChannelDeduct(
      o.storefront,
      emptyGpChannelDeduct(0, "pct"),
    ),
  };
}

/** จากยอดประมาณ GP → เสนอเรท % ของรายได้เดลิเวอรี่ */
export function proposeGpDeductPct(
  deliveryGross: number,
  gpProposeAmount: number,
  fallback = DEFAULT_GP_DEDUCT_PCT,
): number {
  const g = normalizeMoney(deliveryGross);
  const a = normalizeMoney(gpProposeAmount);
  if (g <= 0) return fallback;
  if (a <= 0) return fallback;
  const pct = roundMoney((a / g) * 100);
  return Math.min(100, Math.max(0.01, pct));
}

/**
 * จากยอดโอนหลัง → คชจ. + เรท%
 * คชจ. = รายได้ − ยอดโอนหลัง
 */
export function deriveGpFromNetTransfer(
  gross: number,
  netTransfer: number,
): { deduct: number; pct: number; netTransfer: number } {
  const g = Math.max(0, normalizeMoney(gross));
  const net = Math.max(0, normalizeMoney(netTransfer));
  const deduct = roundMoney(Math.max(0, g - net));
  const pct =
    g > 0 ? Math.min(100, Math.max(0, roundMoney((deduct / g) * 100))) : 0;
  return { deduct, pct, netTransfer: net };
}

/** คำนวณยอดคชจ. GP ตามโหมด */
export function resolveGpDeductAmount(input: {
  mode: GpDeductMode;
  pct: number;
  amount: number;
  deliveryGross: number;
  netTransfer?: number;
}): number {
  // โหมดโอนจริง: คชจ. = amount ที่ใส่/นำเข้า แยกจากยอดโอน (ไม่ = รายได้−โอน)
  if (input.mode === "transfer" || input.mode === "amount") {
    return Math.max(0, normalizeMoney(input.amount));
  }
  const deliveryGross = Math.max(0, normalizeMoney(input.deliveryGross));
  const pct = Math.min(100, Math.max(0, Number(input.pct) || 0));
  return roundMoney((deliveryGross * pct) / 100);
}

/** เรทประมาณจากคชจ. กับยอดโอนจริง */
export function impliedGpPctFromTransfer(
  deduct: number,
  netTransfer: number,
): number {
  const fee = Math.max(0, normalizeMoney(deduct));
  const net = Math.max(0, normalizeMoney(netTransfer));
  const base = roundMoney(fee + net);
  if (base <= 0) return 0;
  return Math.min(100, roundMoney((fee / base) * 100));
}

/** ยอดรายได้ช่องทางตามโหมดก่อน/รวม VAT */
export function channelIncomeGross(
  inclusive: number,
  mode: "exVat" | "incVat",
  outputPct = 7,
): number {
  const gross = Math.max(0, normalizeMoney(inclusive));
  if (gross <= 0) return 0;
  if (mode === "incVat") return gross;
  const pct =
    Number.isFinite(outputPct) && outputPct > 0 ? outputPct : 7;
  const vat = roundMoney((gross * pct) / (100 + pct));
  return roundMoney(Math.max(0, gross - vat));
}

/**
 * รายได้สุทธิเข้า P&L = ยอดถึงร้าน (ยอดโอนจริง + หน้าร้าน)
 * ไม่หักคชจ.ซ้ำ — คชจ.แยกไว้ทำภาษีซื้อ
 * โหมดก่อน VAT = แปลงยอดถึงร้านเป็นก่อน VAT
 */
export function pnlIncomeFromCashBridge(
  cashAtShop: number,
  mode: "exVat" | "incVat",
  outputPct = 7,
  /** @deprecated ไม่หักจากยอดถึงร้านแล้ว — รับไว้ไม่ใช้ */
  _gpDeduct = 0,
): number {
  const cash = roundMoney(Math.max(0, normalizeMoney(cashAtShop)));
  if (mode === "incVat") return cash;
  return channelIncomeGross(cash, "exVat", outputPct);
}

/** สะพานรายได้ → P&L: ยอดโอนจริงถึงร้าน · คชจ./ภาษีซื้อแยก */
export function buildIncomeBridge(input: {
  deliveryVatBase: number;
  deliveryGrossSales: number;
  storefrontVatBase: number;
  storefrontGrossSales: number;
  mode: "exVat" | "incVat";
  /** ยอดขายแพลตฟอร์ม (อ้างอิงนำเข้า) — ตาราง GP ไม่โชว์เป็นคอลัมน์รายได้ */
  deliveryChannels?: { shopee: number; grab: number; lineman: number };
  outputPct?: number;
  gpByChannel?: unknown;
  /** @deprecated ใช้เมื่อยังไม่มี gpByChannel */
  gpDeductMode?: GpDeductMode;
  gpDeductPct?: number;
  gpDeduct?: number;
}): IncomeBridge {
  const platformDelivery = normalizeMoney(input.deliveryGrossSales);
  const storefrontGross = normalizeMoney(input.storefrontGrossSales);
  const outputPct = input.outputPct;

  // เส้นทางเก่า: ไม่ส่งช่องทาง / แผนที่
  if (input.deliveryChannels == null && input.gpByChannel == null) {
    const gpDeductMode: GpDeductMode =
      input.gpDeductMode === "amount"
        ? "amount"
        : input.gpDeductMode === "transfer"
          ? "transfer"
          : "pct";
    const gpDeductPct = Math.min(
      100,
      Math.max(0, Number(input.gpDeductPct) || DEFAULT_GP_DEDUCT_PCT),
    );
    const legacyDeduct = resolveGpDeductAmount({
      mode: gpDeductMode === "pct" ? "pct" : "amount",
      pct: gpDeductPct,
      amount: Number(input.gpDeduct) || 0,
      deliveryGross: platformDelivery,
    });
    // มรดก: ประมาณโอนจริง = ขาย − คชจ.
    const legacyTransfer = roundMoney(
      Math.max(0, platformDelivery - legacyDeduct),
    );
    const cashAtShop = roundMoney(legacyTransfer + storefrontGross);
    const pnlIncome = pnlIncomeFromCashBridge(cashAtShop, input.mode, outputPct);
    const legacyMap = defaultGpByChannel(
      gpDeductPct,
      gpDeductMode === "pct" ? "pct" : "transfer",
    );
    if (gpDeductMode !== "pct") {
      legacyMap.grab = {
        mode: "transfer",
        pct: gpDeductPct,
        amount: legacyDeduct,
        netTransfer: legacyTransfer,
        gpVatOverride: 0,
      };
      legacyMap.shopee = emptyGpChannelDeduct(0, "transfer");
      legacyMap.lineman = emptyGpChannelDeduct(0, "transfer");
    }
    const deliveryGpVat = gpVatFromFee(legacyDeduct, "incVat", outputPct);
    const weightedAvgPct = impliedGpPctFromTransfer(legacyDeduct, legacyTransfer);
    return {
      deliveryGross: legacyTransfer,
      storefrontGross,
      grossTotal: cashAtShop,
      gpDeduct: legacyDeduct,
      deliveryGpVat,
      storefrontGpVat: 0,
      gpVatTotal: deliveryGpVat,
      weightedAvgPct,
      pnlIncome,
      channelRows: [
        {
          key: "grab",
          label: "เดลิเวอรี่ (รวม)",
          gross: platformDelivery,
          netTransfer: legacyTransfer,
          deduct: legacyDeduct,
          impliedPct: weightedAvgPct,
          gpVat: deliveryGpVat,
          settings: legacyMap.grab,
        },
        {
          key: "storefront",
          label: GP_CHANNEL_LABELS.storefront,
          gross: storefrontGross,
          netTransfer: storefrontGross,
          deduct: 0,
          impliedPct: 0,
          gpVat: 0,
          settings: legacyMap.storefront,
        },
      ],
      gpByChannel: legacyMap,
      gpDeductMode: gpDeductMode === "pct" ? "pct" : "amount",
      gpDeductPct,
    };
  }

  const gpByChannel = mapGpByChannel(input.gpByChannel, {
    mode: input.gpDeductMode,
    pct: input.gpDeductPct,
    amount: input.gpDeduct,
  });
  const channels = {
    shopee: normalizeMoney(input.deliveryChannels?.shopee),
    grab: normalizeMoney(input.deliveryChannels?.grab),
    lineman: normalizeMoney(input.deliveryChannels?.lineman),
  };
  const chSum = roundMoney(channels.shopee + channels.grab + channels.lineman);
  const channelRows: GpChannelRow[] = [];
  let gpDeduct = 0;
  let deliveryDeduct = 0;
  let deliveryTransfer = 0;
  let deliveryGpVat = 0;
  let storefrontGpVat = 0;

  for (const key of GP_DELIVERY_CHANNEL_KEYS) {
    const settings = gpByChannel[key];
    const gross =
      chSum <= 0 && key === "grab" ? platformDelivery : channels[key];
    const deduct = resolveGpDeductAmount({
      mode: settings.mode === "pct" ? "pct" : "transfer",
      pct: settings.pct,
      amount: settings.amount,
      deliveryGross: gross,
      netTransfer: settings.netTransfer,
    });
    // ยอดโอนจริง — โหมดโอน/ยอดใช้ค่าที่ใส่ · โหมด% ประมาณจากขาย−คชจ.
    const netTransfer =
      settings.mode === "pct"
        ? roundMoney(Math.max(0, gross - deduct))
        : normalizeMoney(settings.netTransfer);
    const impliedPct =
      settings.mode === "pct"
        ? settings.pct
        : impliedGpPctFromTransfer(deduct, netTransfer);
    const gpVat =
      settings.gpVatOverride > 0
        ? normalizeMoney(settings.gpVatOverride)
        : gpVatFromFee(deduct, "incVat", outputPct);
    gpDeduct = roundMoney(gpDeduct + deduct);
    deliveryDeduct = roundMoney(deliveryDeduct + deduct);
    deliveryTransfer = roundMoney(deliveryTransfer + netTransfer);
    deliveryGpVat = roundMoney(deliveryGpVat + gpVat);
    channelRows.push({
      key,
      label:
        chSum <= 0 && key === "grab"
          ? "เดลิเวอรี่ (รวม)"
          : GP_CHANNEL_LABELS[key],
      gross,
      netTransfer,
      deduct,
      impliedPct,
      gpVat,
      settings,
    });
  }

  {
    const settings = gpByChannel.storefront;
    const deduct = resolveGpDeductAmount({
      mode: settings.mode === "pct" ? "pct" : "transfer",
      pct: settings.pct,
      amount: settings.amount,
      deliveryGross: storefrontGross,
      netTransfer: settings.netTransfer,
    });
    const netTransfer =
      settings.mode === "transfer" && settings.netTransfer > 0
        ? normalizeMoney(settings.netTransfer)
        : roundMoney(Math.max(0, storefrontGross - deduct));
    const impliedPct =
      settings.mode === "pct"
        ? settings.pct
        : impliedGpPctFromTransfer(deduct, netTransfer);
    const gpVat =
      settings.gpVatOverride > 0
        ? normalizeMoney(settings.gpVatOverride)
        : gpVatFromFee(deduct, "incVat", outputPct);
    gpDeduct = roundMoney(gpDeduct + deduct);
    storefrontGpVat = gpVat;
    channelRows.push({
      key: "storefront",
      label: GP_CHANNEL_LABELS.storefront,
      gross: storefrontGross,
      netTransfer,
      deduct,
      impliedPct,
      gpVat,
      settings,
    });
  }

  const storefrontTransfer =
    channelRows.find((r) => r.key === "storefront")?.netTransfer || 0;
  const cashAtShop = roundMoney(deliveryTransfer + storefrontTransfer);
  const pnlIncome = pnlIncomeFromCashBridge(cashAtShop, input.mode, outputPct);
  const weightedAvgPct = impliedGpPctFromTransfer(
    deliveryDeduct,
    deliveryTransfer,
  );
  const grabMode = gpByChannel.grab.mode;
  return {
    deliveryGross: deliveryTransfer,
    storefrontGross: storefrontTransfer,
    grossTotal: cashAtShop,
    gpDeduct,
    deliveryGpVat,
    storefrontGpVat,
    gpVatTotal: roundMoney(deliveryGpVat + storefrontGpVat),
    weightedAvgPct,
    pnlIncome,
    channelRows,
    gpByChannel,
    gpDeductMode: grabMode === "transfer" ? "amount" : grabMode,
    gpDeductPct: gpByChannel.grab.pct,
  };
}
