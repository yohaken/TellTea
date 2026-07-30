/**
 * โมเดลหน้าเดือนใหม่ — แยกชั้นเงินถึงร้าน/กำไร กับชั้น VAT
 * อ่าน–เขียนทับ vatMonthlyReturns เดิม · นำเข้ายังผสานเข้า doc เดิมได้
 */
import {
  buildIncomeBridge,
  gpVatFromFee,
  impliedGpPctFromTransfer,
  mapGpByChannel,
  type GpByChannel,
  type GpChannelKey,
} from "./personal-income-tax";
import {
  recomputeSegment,
  sumMonthlyTotals,
  type VatMonthlyReturn,
  type VatMonthlySaveInput,
  type VatSegmentState,
} from "./vat-monthly";
import { normalizeMoney, roundMoney } from "./vat-sales";

export type MonthChannel = "shopee" | "grab" | "lineman";

export const MONTH_CHANNELS: readonly MonthChannel[] = [
  "shopee",
  "grab",
  "lineman",
] as const;

export const MONTH_CHANNEL_LABEL: Record<MonthChannel, string> = {
  shopee: "ShopeeFood",
  grab: "Grab",
  lineman: "LINE MAN",
};

export const MONTH_CHANNEL_SHORT: Record<MonthChannel, string> = {
  shopee: "SF",
  grab: "GB",
  lineman: "LM",
};

/** ร่างแก้ไขบนหน้า — ตัวเลขเป็น number ล้วน */
export type MonthBooksDraft = {
  monthKey: string;
  /** ยอดโอนถึงร้าน (รายได้) */
  transfer: Record<MonthChannel, number> & { storefront: number };
  /** คชจ. GP เดลิเวอรี่ */
  gpFee: Record<MonthChannel, number>;
  /** ภาษีซื้อ GP จากใบกำกับ (0 = ประมาณจากคชจ.×7/107) */
  gpVatOverride: Record<MonthChannel, number>;
  /** ยอดขายคิดภาษีขาย */
  sales: Record<MonthChannel, number> & {
    storefrontTransfer: number;
    storefrontCash: number;
  };
  ingredientVat: number;
  outputPct: number;
  note: string;
  status: VatMonthlyReturn["status"];
  /**
   * นำภาษีซื้อมารวมหักจากภาษีขาย
   * false = ช่วงจด VAT ขอคืนไม่ได้ → เตรียมจ่ายภาษีขายเต็ม
   */
  includeInputVat: boolean;
};

export type MonthBooksView = {
  /** A — รายได้ถึงร้าน = ยอดโอน (หลังหัก GP แล้ว) + หน้าร้าน */
  incomeTotal: number;
  deliveryTransfer: number;
  storefrontIncome: number;
  /**
   * คชจ. GP แพลตฟอร์ม — หักจากยอดโอนแล้ว
   * โชว์ติดตาม / ใช้คิดภาษีซื้อ · **ไม่หักซ้ำในกำไร**
   */
  gpCostTotal: number;
  /** คชจ. สองบช. ที่หักกำไรได้ (ไม่รวมสินทรัพย์) */
  booksOpex: number | null;
  booksAsset: number;
  /** คชจ. ที่หักกำไร = เฉพาะบช. (ไม่รวม GP) */
  costTotal: number | null;
  /** C — กำไรประมาณการ = รายได้ถึงร้าน − คชจ.บช. */
  monthProfit: number | null;
  /** กำไรสุทธิหลังหัก VAT สุทธิ (เงินเหลือโดยประมาณ) */
  profitAfterVat: number | null;
  /** D — VAT */
  salesTotal: number;
  outputVat: number;
  inputGpVat: number;
  inputBooksVat: number;
  /** ภาษีซื้อที่คำนวณได้ (โชว์เสมอ) */
  inputVat: number;
  /** ภาษีซื้อที่นำมาหักจริง (0 ถ้าปิดติ๊ก) */
  inputVatApplied: number;
  netVat: number;
  includeInputVat: boolean;
  delivery: VatSegmentState;
  storefront: VatSegmentState;
  gpByChannel: GpByChannel;
};

function emptyTransfer(): MonthBooksDraft["transfer"] {
  return { shopee: 0, grab: 0, lineman: 0, storefront: 0 };
}

function emptyGp(): Record<MonthChannel, number> {
  return { shopee: 0, grab: 0, lineman: 0 };
}

function emptySales(): MonthBooksDraft["sales"] {
  return {
    shopee: 0,
    grab: 0,
    lineman: 0,
    storefrontTransfer: 0,
    storefrontCash: 0,
  };
}

export function emptyMonthBooksDraft(monthKey: string): MonthBooksDraft {
  return {
    monthKey,
    transfer: emptyTransfer(),
    gpFee: emptyGp(),
    gpVatOverride: emptyGp(),
    sales: emptySales(),
    ingredientVat: 0,
    outputPct: 7,
    note: "",
    status: "draft",
    includeInputVat: true,
  };
}

/** VatMonthlyReturn → ร่างหน้าใหม่ */
export function retToMonthBooksDraft(ret: VatMonthlyReturn): MonthBooksDraft {
  const gp = mapGpByChannel(ret.pnlGpByChannel);
  const transfer = emptyTransfer();
  const gpFee = emptyGp();
  const gpVatOverride = emptyGp();
  for (const k of MONTH_CHANNELS) {
    transfer[k] = normalizeMoney(gp[k].netTransfer);
    gpFee[k] = normalizeMoney(gp[k].amount);
    gpVatOverride[k] = normalizeMoney(gp[k].gpVatOverride);
  }
  // หน้าร้าน: โอนจริงจาก gp · ถ้าไม่มี ใช้ยอดขายหน้าร้าน
  const sfNet = normalizeMoney(gp.storefront.netTransfer);
  const sfSales = normalizeMoney(ret.storefront.reportedGross);
  transfer.storefront = sfNet > 0 ? sfNet : sfSales;

  return {
    monthKey: ret.monthKey,
    transfer,
    gpFee,
    gpVatOverride,
    sales: {
      shopee: normalizeMoney(ret.delivery.channels.shopee),
      grab: normalizeMoney(ret.delivery.channels.grab),
      lineman: normalizeMoney(ret.delivery.channels.lineman),
      storefrontTransfer: normalizeMoney(ret.storefront.tenders.transfer),
      storefrontCash: normalizeMoney(ret.storefront.tenders.cash),
    },
    ingredientVat: normalizeMoney(
      ret.storefront.ingredientVat || ret.delivery.ingredientVat,
    ),
    outputPct: normalizeMoney(ret.delivery.rates.outputPct) || 7,
    note: ret.note || "",
    status: ret.status,
    includeInputVat: ret.includeInputVat !== false,
  };
}

export function draftToGpByChannel(draft: MonthBooksDraft): GpByChannel {
  const base = mapGpByChannel(undefined);
  for (const k of MONTH_CHANNELS) {
    const net = normalizeMoney(draft.transfer[k]);
    const fee = normalizeMoney(draft.gpFee[k]);
    base[k] = {
      mode: "transfer",
      netTransfer: net,
      amount: fee,
      pct: impliedGpPctFromTransfer(fee, net),
      gpVatOverride: normalizeMoney(draft.gpVatOverride[k]),
    };
  }
  const sf = normalizeMoney(draft.transfer.storefront);
  base.storefront = {
    mode: "transfer",
    netTransfer: sf,
    amount: 0,
    pct: 0,
    gpVatOverride: 0,
  };
  return base;
}

function ratesFromPct(outputPct: number) {
  const pct = Math.min(99, Math.max(0.01, outputPct || 7));
  return {
    outputPct: pct,
    outputNum: pct,
    outputDen: 100 + pct,
    gpOfOutput: 0,
    inputClaimFactor: 1,
    floorInput: true,
  };
}

/** สร้าง segment เดลิเวอรี่/หน้าร้านจากร่าง */
export function draftToSegments(draft: MonthBooksDraft): {
  delivery: VatSegmentState;
  storefront: VatSegmentState;
} {
  const rates = ratesFromPct(draft.outputPct);
  const gpMap = draftToGpByChannel(draft);
  let deliveryGpVat = 0;
  for (const k of MONTH_CHANNELS) {
    const override = gpMap[k].gpVatOverride;
    const fee = gpMap[k].amount;
    deliveryGpVat = roundMoney(
      deliveryGpVat +
        (override > 0 ? override : gpVatFromFee(fee, "incVat", draft.outputPct)),
    );
  }
  const delivery = recomputeSegment({
    kind: "delivery",
    grossManual: 0,
    channels: {
      shopee: draft.sales.shopee,
      grab: draft.sales.grab,
      lineman: draft.sales.lineman,
    },
    tenders: { transfer: 0, cash: 0 },
    remitPct: 100,
    gpVat: deliveryGpVat,
    useGpEstimate: false,
    ingredientVat: 0,
    rates,
  });
  const storefront = recomputeSegment({
    kind: "storefront",
    grossManual: 0,
    channels: { shopee: 0, grab: 0, lineman: 0 },
    tenders: {
      transfer: draft.sales.storefrontTransfer,
      cash: draft.sales.storefrontCash,
    },
    remitPct: 100,
    gpVat: 0,
    useGpEstimate: false,
    ingredientVat: draft.ingredientVat,
    rates,
  });
  return { delivery, storefront };
}

export function deriveMonthBooksView(
  draft: MonthBooksDraft,
  books?: { cogs: number; sga: number; other: number; asset: number } | null,
): MonthBooksView {
  const gpByChannel = draftToGpByChannel(draft);
  const { delivery, storefront } = draftToSegments(draft);
  const bridge = buildIncomeBridge({
    deliveryVatBase: delivery.vatBase,
    deliveryGrossSales: delivery.grossSales,
    storefrontVatBase: storefront.vatBase,
    storefrontGrossSales: storefront.grossSales,
    mode: "incVat",
    deliveryChannels: delivery.channels,
    outputPct: draft.outputPct,
    gpByChannel,
  });

  const deliveryTransfer = roundMoney(
    draft.transfer.shopee + draft.transfer.grab + draft.transfer.lineman,
  );
  const storefrontIncome = normalizeMoney(draft.transfer.storefront);
  const incomeTotal = roundMoney(deliveryTransfer + storefrontIncome);
  // GP หักจากยอดโอนแล้ว — เก็บไว้โชว์/VAT ห้ามหักซ้ำในกำไร
  const gpCostTotal = bridge.gpDeduct;
  const booksOpex =
    books == null
      ? null
      : roundMoney(
          (books.cogs || 0) + (books.sga || 0) + (books.other || 0),
        );
  const booksAsset = books == null ? 0 : normalizeMoney(books.asset);
  // หักกำไรได้แค่คชจ.บช. · GP อยู่ในยอดโอนแล้ว
  const costTotal = booksOpex;
  const monthProfit =
    booksOpex == null
      ? incomeTotal
      : roundMoney(incomeTotal - booksOpex);

  const salesTotal = roundMoney(
    delivery.reportedGross + storefront.reportedGross,
  );
  const outputVat = roundMoney(delivery.outputVat + storefront.outputVat);
  const inputGpVat = bridge.deliveryGpVat;
  const inputBooksVat = normalizeMoney(storefront.ingredientVatClaimed);
  const inputVat = roundMoney(inputGpVat + inputBooksVat);
  // ภาษีขายหลีกเลี่ยงไม่ได้ · ภาษีซื้อหักได้เฉพาะเมื่อติ๊ก includeInputVat
  const includeInputVat = draft.includeInputVat !== false;
  const inputVatApplied = includeInputVat ? inputVat : 0;
  const netVat = roundMoney(outputVat - inputVatApplied);
  // กำไรสุทธิหลัง VAT = กำไรประมาณการ − VAT สุทธิ (VAT ติดลบ = ได้คืน → บวกเข้า)
  const profitAfterVat =
    monthProfit == null ? null : roundMoney(monthProfit - netVat);

  return {
    incomeTotal,
    deliveryTransfer,
    storefrontIncome,
    gpCostTotal,
    booksOpex,
    booksAsset,
    costTotal,
    monthProfit,
    profitAfterVat,
    salesTotal,
    outputVat,
    inputGpVat,
    inputBooksVat,
    inputVat,
    inputVatApplied,
    netVat,
    includeInputVat,
    delivery,
    storefront,
    gpByChannel,
  };
}

/** ร่าง → payload เซฟ Firestore */
export function draftToSaveInput(
  draft: MonthBooksDraft,
  status: "draft" | "saved" = "saved",
): VatMonthlySaveInput {
  const view = deriveMonthBooksView(draft);
  const { delivery, storefront } = view;
  return {
    monthKey: draft.monthKey,
    delivery: {
      kind: "delivery",
      grossManual: delivery.grossManual,
      channels: delivery.channels,
      tenders: delivery.tenders,
      remitPct: 100,
      gpVat: delivery.gpVat,
      useGpEstimate: false,
      ingredientVat: 0,
      rates: delivery.rates,
    },
    storefront: {
      kind: "storefront",
      grossManual: storefront.grossManual,
      channels: storefront.channels,
      tenders: storefront.tenders,
      remitPct: 100,
      gpVat: 0,
      useGpEstimate: false,
      ingredientVat: draft.ingredientVat,
      rates: storefront.rates,
    },
    note: draft.note,
    pnlIncomeMode: "incVat",
    pnlIncome: view.incomeTotal,
    pnlDeliveryGpDeduct: view.gpCostTotal,
    pnlDeliveryGpMode: "amount",
    pnlDeliveryGpPct: 0,
    pnlGpByChannel: view.gpByChannel,
    includeInputVat: draft.includeInputVat !== false,
    status,
  };
}

export function patchTransfer(
  draft: MonthBooksDraft,
  key: MonthChannel | "storefront",
  value: number,
): MonthBooksDraft {
  return {
    ...draft,
    transfer: { ...draft.transfer, [key]: normalizeMoney(value) },
  };
}

export function patchGpFee(
  draft: MonthBooksDraft,
  key: MonthChannel,
  value: number,
): MonthBooksDraft {
  return {
    ...draft,
    gpFee: { ...draft.gpFee, [key]: normalizeMoney(value) },
  };
}

export function patchGpVat(
  draft: MonthBooksDraft,
  key: MonthChannel,
  value: number,
): MonthBooksDraft {
  return {
    ...draft,
    gpVatOverride: { ...draft.gpVatOverride, [key]: normalizeMoney(value) },
  };
}

export function patchSales(
  draft: MonthBooksDraft,
  key: keyof MonthBooksDraft["sales"],
  value: number,
): MonthBooksDraft {
  return {
    ...draft,
    sales: { ...draft.sales, [key]: normalizeMoney(value) },
  };
}

/**
 * แถบส่งหน้าร้าน → A รายได้ถึงร้าน + D ยอดขายโอนทั้งก้อน (คิดภาษีขาย)
 * เคลียร์ยอดสดกันนับซ้ำในภาษีขาย
 */
export function patchSfSendIntoDraft(
  draft: MonthBooksDraft,
  sent: number,
): MonthBooksDraft {
  const n = normalizeMoney(sent);
  const next = patchTransfer(draft, "storefront", n);
  return {
    ...next,
    sales: {
      ...next.sales,
      storefrontTransfer: n,
      storefrontCash: 0,
    },
  };
}

export function incomeBreakdownLabel(draft: MonthBooksDraft): string {
  const parts = MONTH_CHANNELS.map(
    (k) =>
      `${MONTH_CHANNEL_SHORT[k]} ${normalizeMoney(draft.transfer[k]).toFixed(2)}`,
  );
  parts.push(`หน้าร้าน ${normalizeMoney(draft.transfer.storefront).toFixed(2)}`);
  return parts.join(" + ");
}

/** รวมยอดจาก VatMonthlyReturn ที่นำเข้าเพิ่งเซฟ — ใช้ hydrate หน้า */
export function applySavedReturnToDraft(
  draft: MonthBooksDraft,
  saved: VatMonthlyReturn,
): MonthBooksDraft {
  if (saved.monthKey !== draft.monthKey) return draft;
  return retToMonthBooksDraft(saved);
}

export function totalsFromDraft(draft: MonthBooksDraft) {
  const { delivery, storefront } = draftToSegments(draft);
  return sumMonthlyTotals(
    delivery,
    storefront,
    delivery.grossSales,
    storefront.grossSales,
  );
}

export type { GpChannelKey };
