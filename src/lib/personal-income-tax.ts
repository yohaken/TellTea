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

/** โหมดหัก GP — เรท % หรือยอดบาท fix */
export type GpDeductMode = "pct" | "amount";

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
  amount: number;
};

export type GpByChannel = Record<GpChannelKey, GpChannelDeduct>;

export type GpChannelRow = {
  key: GpChannelKey;
  label: string;
  /** รายได้ช่องทางตามโหมดก่อน/รวม VAT */
  gross: number;
  deduct: number;
  settings: GpChannelDeduct;
};

export type IncomeBridge = {
  deliveryGross: number;
  storefrontGross: number;
  grossTotal: number;
  /** รวมหักทุกช่องทาง */
  gpDeduct: number;
  /** รายได้สุทธิที่ควรใส่ P&L */
  pnlIncome: number;
  /** แถวหักรายช่องทาง (เดลิเวอรี่ + หน้าร้าน) */
  channelRows: GpChannelRow[];
  gpByChannel: GpByChannel;
  /**
   * @deprecated ค่าเฉลี่ย/มรดก — UI ใช้รายช่องทาง
   * คงไว้ให้เซฟเก่าอ่านได้
   */
  gpDeductMode: GpDeductMode;
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
  };
}

/** ค่าเริ่ม: เดลิเวอรี่ 3 ช่องทางใช้เรทเดียวกัน · หน้าร้านไม่หัก (0%) */
export function defaultGpByChannel(
  deliveryPct = DEFAULT_GP_DEDUCT_PCT,
  deliveryMode: GpDeductMode = "pct",
): GpByChannel {
  const d = emptyGpChannelDeduct(deliveryPct, deliveryMode);
  return {
    shopee: { ...d },
    grab: { ...d },
    lineman: { ...d },
    storefront: emptyGpChannelDeduct(0, "pct"),
  };
}

export function mapGpChannelDeduct(
  raw: unknown,
  fallback: GpChannelDeduct = emptyGpChannelDeduct(DEFAULT_GP_DEDUCT_PCT),
): GpChannelDeduct {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode: GpDeductMode = o.mode === "amount" ? "amount" : "pct";
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
  return { mode, pct, amount };
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
  const legacyMode: GpDeductMode =
    legacy?.mode === "amount" ? "amount" : "pct";
  const legacyPct =
    Number.isFinite(Number(legacy?.pct)) && Number(legacy?.pct) > 0
      ? Number(legacy?.pct)
      : DEFAULT_GP_DEDUCT_PCT;
  const base = defaultGpByChannel(legacyPct, legacyMode);
  if (legacyMode === "amount" && Number(legacy?.amount) > 0) {
    // มรดกยอดก้อน — ใส่ Grab เป็นที่เก็บหลัก (แยกมือทีหลังได้)
    base.grab = {
      mode: "amount",
      pct: legacyPct,
      amount: normalizeMoney(Number(legacy?.amount)),
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

/** คำนวณยอดหัก GP ตามโหมด (ต่อฐานรายได้ช่องทาง) */
export function resolveGpDeductAmount(input: {
  mode: GpDeductMode;
  pct: number;
  amount: number;
  deliveryGross: number;
}): number {
  const deliveryGross = Math.max(0, normalizeMoney(input.deliveryGross));
  if (input.mode === "pct") {
    const pct = Math.min(100, Math.max(0, Number(input.pct) || 0));
    return roundMoney((deliveryGross * pct) / 100);
  }
  return Math.max(0, normalizeMoney(input.amount));
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

/** สะพานรายได้ → P&L: แยกร้าน/ส่ง · หัก GP รายช่องทาง */
export function buildIncomeBridge(input: {
  deliveryVatBase: number;
  deliveryGrossSales: number;
  storefrontVatBase: number;
  storefrontGrossSales: number;
  mode: "exVat" | "incVat";
  /** ยอดรวม VAT (inc) รายช่องทางเดลิเวอรี่ — แยกหัก GP */
  deliveryChannels?: { shopee: number; grab: number; lineman: number };
  outputPct?: number;
  gpByChannel?: unknown;
  /** @deprecated ใช้เมื่อยังไม่มี gpByChannel */
  gpDeductMode?: GpDeductMode;
  gpDeductPct?: number;
  gpDeduct?: number;
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

  // เส้นทางเก่า: ไม่ส่งช่องทาง / แผนที่ → หักก้อนเดียวจากยอดเดลิเวอรี่รวม
  if (input.deliveryChannels == null && input.gpByChannel == null) {
    const gpDeductMode: GpDeductMode =
      input.gpDeductMode === "amount" ? "amount" : "pct";
    const gpDeductPct = Math.min(
      100,
      Math.max(0, Number(input.gpDeductPct) || DEFAULT_GP_DEDUCT_PCT),
    );
    const legacyDeduct = resolveGpDeductAmount({
      mode: gpDeductMode,
      pct: gpDeductPct,
      amount: Number(input.gpDeduct) || 0,
      deliveryGross,
    });
    const pnlIncome = roundMoney(Math.max(0, grossTotal - legacyDeduct));
    const legacyMap = defaultGpByChannel(gpDeductPct, gpDeductMode);
    if (gpDeductMode === "amount") {
      legacyMap.grab = {
        mode: "amount",
        pct: gpDeductPct,
        amount: legacyDeduct,
      };
      legacyMap.shopee = emptyGpChannelDeduct(0);
      legacyMap.lineman = emptyGpChannelDeduct(0);
    }
    return {
      deliveryGross,
      storefrontGross,
      grossTotal,
      gpDeduct: legacyDeduct,
      pnlIncome,
      channelRows: [
        {
          key: "grab",
          label: "เดลิเวอรี่ (รวม)",
          gross: deliveryGross,
          deduct: legacyDeduct,
          settings: legacyMap.grab,
        },
        {
          key: "storefront",
          label: GP_CHANNEL_LABELS.storefront,
          gross: storefrontGross,
          deduct: 0,
          settings: legacyMap.storefront,
        },
      ],
      gpByChannel: legacyMap,
      gpDeductMode,
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
  const chSum = channels.shopee + channels.grab + channels.lineman;
  const outputPct = input.outputPct;
  const channelRows: GpChannelRow[] = [];
  let gpDeduct = 0;

  for (const key of GP_DELIVERY_CHANNEL_KEYS) {
    const settings = gpByChannel[key];
    // ยังไม่แยกช่องในตารางขาย — ใส่ยอดรวมที่แถว Grab ชั่วคราว
    const gross =
      chSum <= 0 && key === "grab"
        ? deliveryGross
        : channelIncomeGross(channels[key], input.mode, outputPct);
    const deduct = resolveGpDeductAmount({
      mode: settings.mode,
      pct: settings.pct,
      amount: settings.amount,
      deliveryGross: gross,
    });
    gpDeduct = roundMoney(gpDeduct + deduct);
    channelRows.push({
      key,
      label: chSum <= 0 && key === "grab" ? "เดลิเวอรี่ (รวม)" : GP_CHANNEL_LABELS[key],
      gross,
      deduct,
      settings,
    });
  }

  {
    const settings = gpByChannel.storefront;
    const deduct = resolveGpDeductAmount({
      mode: settings.mode,
      pct: settings.pct,
      amount: settings.amount,
      deliveryGross: storefrontGross,
    });
    gpDeduct = roundMoney(gpDeduct + deduct);
    channelRows.push({
      key: "storefront",
      label: GP_CHANNEL_LABELS.storefront,
      gross: storefrontGross,
      deduct,
      settings,
    });
  }

  const pnlIncome = roundMoney(Math.max(0, grossTotal - gpDeduct));
  return {
    deliveryGross,
    storefrontGross,
    grossTotal,
    gpDeduct,
    pnlIncome,
    channelRows,
    gpByChannel,
    gpDeductMode: gpByChannel.grab.mode,
    gpDeductPct: gpByChannel.grab.pct,
  };
}
