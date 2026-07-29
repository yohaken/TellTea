/**
 * I5 — รวมแถวนำเข้าเข้าเดือน VAT (ยอดขาย / ยอดโอน / ภาษีซื้อ GP)
 */
import {
  buildIncomeBridge,
  deriveGpFromNetTransfer,
  impliedGpPctFromTransfer,
  mapGpByChannel,
  type GpByChannel,
  type GpChannelKey,
} from "./personal-income-tax";
import {
  loadVatMonthlyReturn,
  recomputeSegment,
  saveVatMonthlyReturn,
  saveVatMonthlySettings,
  type VatMonthlyReturn,
} from "./vat-monthly";
import { normalizeMoney, roundMoney } from "./vat-sales";
import {
  patchVatImportRow,
  type VatImportChannel,
  type VatImportRow,
} from "./vat-import";
import { notifyVatImportMonthMerged } from "./vat-import-month-sync";

const DELIVERY_KEYS = ["shopee", "grab", "lineman"] as const satisfies ReadonlyArray<
  Exclude<VatImportChannel, "storefront">
>;

export type ChannelApplySum = {
  gross: number;
  netTransfer: number;
  fee: number;
  gpVat: number;
  salesCount: number;
  vatCount: number;
};

export type ApplyVatImportPreview = {
  monthKey: string;
  byChannel: Record<VatImportChannel, ChannelApplySum>;
  deliveryGpVat: number;
  rowIds: string[];
};

function emptySum(): ChannelApplySum {
  return {
    gross: 0,
    netTransfer: 0,
    fee: 0,
    gpVat: 0,
    salesCount: 0,
    vatCount: 0,
  };
}

/** รวมแถวที่จะ apply (ข้าม skipped) */
export function previewApplyVatImportRows(
  monthKey: string,
  rows: VatImportRow[],
): ApplyVatImportPreview {
  const byChannel: Record<VatImportChannel, ChannelApplySum> = {
    shopee: emptySum(),
    grab: emptySum(),
    lineman: emptySum(),
    storefront: emptySum(),
  };
  const rowIds: string[] = [];
  for (const r of rows) {
    if (r.status === "skipped") continue;
    if (r.monthKey !== monthKey) continue;
    rowIds.push(r.id);
    const b = byChannel[r.channel];
    b.gross = normalizeMoney(b.gross + r.grossInclusive);
    b.netTransfer = normalizeMoney(b.netTransfer + r.netTransfer);
    b.fee = normalizeMoney(b.fee + r.fee);
    b.gpVat = normalizeMoney(b.gpVat + r.gpVat);
    if (r.rowKind === "sales" || r.grossInclusive > 0) b.salesCount += 1;
    if (r.rowKind === "tax_invoice" || r.gpVat > 0) b.vatCount += 1;
  }
  let deliveryGpVat = 0;
  for (const k of DELIVERY_KEYS) {
    deliveryGpVat = normalizeMoney(deliveryGpVat + byChannel[k].gpVat);
  }
  return { monthKey, byChannel, deliveryGpVat, rowIds };
}

/** มียอดขาย / โอน / GP / ภาษีซื้อ ที่จะผสานเข้าเดือน */
function channelHasApplyMoney(sum: ChannelApplySum): boolean {
  return (
    sum.gross > 0 ||
    sum.netTransfer > 0 ||
    sum.fee > 0 ||
    sum.gpVat > 0
  );
}

/**
 * ผูกยอดโอน (+ คชจ. GP) จากนำเข้าเข้าแผนที่ช่องทางตาราง 1/2
 * — ไม่ต้องรอมียอดขาย: ใส่แค่ยอดโอนก็เข้าตาราง 1 ได้
 */
function patchChannelGp(
  prev: GpByChannel,
  key: GpChannelKey,
  sum: ChannelApplySum,
): GpByChannel {
  const next = { ...prev, [key]: { ...prev[key] } };
  const hasMoney =
    sum.gross > 0 || sum.netTransfer > 0 || sum.fee > 0;
  if (hasMoney) {
    const derived = deriveGpFromNetTransfer(sum.gross, sum.netTransfer);
    const fee =
      sum.fee > 0 ? normalizeMoney(sum.fee) : derived.deduct;
    const net = normalizeMoney(sum.netTransfer);
    const pct =
      sum.gross > 0
        ? derived.pct
        : impliedGpPctFromTransfer(fee, net);
    next[key] = {
      mode: "transfer",
      netTransfer: net,
      amount: fee,
      pct,
      gpVatOverride:
        sum.gpVat > 0 ? sum.gpVat : next[key].gpVatOverride || 0,
    };
  } else if (sum.gpVat > 0) {
    next[key] = {
      ...next[key],
      gpVatOverride: sum.gpVat,
    };
  }
  return next;
}

/**
 * ผสานแถวนำเข้า → vatMonthlyReturns/{month} (เนื้อเดียวกับแท็บเดือน)
 * - ค่าเริ่ม: ไม่ล็อกแถวเป็น applied (แก้ต่อได้ · ซิงก์อัตโนมัติ)
 * - markApplied: true = โหมดเก่า (ตั้ง applied)
 */
export async function mergeVatImportIntoMonth(input: {
  monthKey: string;
  rows: VatImportRow[];
  actor: string;
  markApplied?: boolean;
}): Promise<{
  preview: ApplyVatImportPreview;
  saved: VatMonthlyReturn;
  mergedCount: number;
  skipped: boolean;
  reason?: string;
}> {
  const preview = previewApplyVatImportRows(input.monthKey, input.rows);
  if (preview.rowIds.length === 0) {
    return {
      preview,
      saved: await loadVatMonthlyReturn(input.monthKey),
      mergedCount: 0,
      skipped: true,
      reason: "ไม่มีแถว",
    };
  }
  const ret = await loadVatMonthlyReturn(input.monthKey);
  if (ret.status === "filed") {
    return {
      preview,
      saved: ret,
      mergedCount: 0,
      skipped: true,
      reason: "เดือนปิดงบแล้ว",
    };
  }

  const channels = { ...ret.delivery.channels };
  let gpMap = mapGpByChannel(ret.pnlGpByChannel);
  let touchedVat = false;
  let touchedSales = false;
  let touchedTransfer = false;

  for (const k of DELIVERY_KEYS) {
    const sum = preview.byChannel[k];
    if (!channelHasApplyMoney(sum)) continue;
    if (sum.gross > 0) {
      channels[k] = sum.gross;
      touchedSales = true;
    }
    if (sum.netTransfer > 0 || sum.fee > 0 || sum.gross > 0) {
      touchedTransfer = true;
    }
    gpMap = patchChannelGp(gpMap, k, sum);
    if (sum.gpVat > 0) touchedVat = true;
  }

  if (!touchedSales && !touchedVat && !touchedTransfer) {
    return {
      preview,
      saved: ret,
      mergedCount: 0,
      skipped: true,
      reason: "ยังไม่มียอดที่จะผสาน",
    };
  }

  const overrideSum = roundMoney(
    DELIVERY_KEYS.reduce(
      (s, k) => s + normalizeMoney(gpMap[k].gpVatOverride),
      0,
    ),
  );
  const deliveryGpVat = touchedVat
    ? overrideSum
    : overrideSum > 0
      ? overrideSum
      : normalizeMoney(ret.delivery.gpVat);

  const deliverySeg = recomputeSegment({
    ...ret.delivery,
    kind: "delivery",
    grossManual: 0,
    channels,
    remitPct: 100,
    gpVat: deliveryGpVat,
    useGpEstimate: false,
  });
  const storefrontSeg = recomputeSegment({
    ...ret.storefront,
    kind: "storefront",
  });
  const bridge = buildIncomeBridge({
    deliveryVatBase: deliverySeg.vatBase,
    deliveryGrossSales: deliverySeg.grossSales,
    storefrontVatBase: storefrontSeg.vatBase,
    storefrontGrossSales: storefrontSeg.grossSales,
    mode: ret.pnlIncomeMode === "exVat" ? "exVat" : "incVat",
    deliveryChannels: channels,
    outputPct: deliverySeg.rates.outputPct,
    gpByChannel: gpMap,
  });

  const saved = await saveVatMonthlyReturn(
    {
      monthKey: input.monthKey,
      delivery: {
        kind: "delivery",
        grossManual: 0,
        channels,
        tenders: ret.delivery.tenders,
        remitPct: 100,
        gpVat: deliveryGpVat,
        useGpEstimate: false,
        ingredientVat: ret.delivery.ingredientVat,
        rates: ret.delivery.rates,
      },
      storefront: {
        kind: "storefront",
        grossManual: ret.storefront.grossManual,
        channels: ret.storefront.channels,
        tenders: ret.storefront.tenders,
        remitPct: ret.storefront.remitPct,
        gpVat: ret.storefront.gpVat,
        useGpEstimate: ret.storefront.useGpEstimate,
        ingredientVat: ret.storefront.ingredientVat,
        rates: ret.storefront.rates,
      },
      note: ret.note,
      pnlIncomeMode: ret.pnlIncomeMode === "exVat" ? "exVat" : "incVat",
      // ผูกยอดคำนวณจากยอดโอนตาราง 1 ทันทีเมื่อนำเข้าซิงก์
      pnlIncome: bridge.pnlIncome,
      pnlDeliveryGpDeduct: bridge.gpDeduct,
      pnlDeliveryGpMode: "amount",
      pnlDeliveryGpPct: bridge.gpDeductPct,
      pnlGpByChannel: gpMap,
      status: ret.status === "saved" ? "saved" : "draft",
    },
    input.actor,
  );

  void saveVatMonthlySettings({ pnlGpByChannel: gpMap }, input.actor).catch(
    () => undefined,
  );

  notifyVatImportMonthMerged(input.monthKey, saved);

  if (input.markApplied) {
    const now = Date.now();
    for (const id of preview.rowIds) {
      await patchVatImportRow(
        id,
        {
          status: "applied",
          appliedAt: now,
          appliedToMonth: input.monthKey,
        },
        input.actor,
      );
    }
  }

  return {
    preview,
    saved,
    mergedCount: preview.rowIds.length,
    skipped: false,
  };
}

/** @deprecated ใช้ mergeVatImportIntoMonth — คงชื่อเดิมให้โค้ดเก่า */
export async function applyVatImportRowsToMonth(input: {
  monthKey: string;
  rows: VatImportRow[];
  actor: string;
}): Promise<{
  preview: ApplyVatImportPreview;
  saved: VatMonthlyReturn;
  appliedCount: number;
}> {
  const result = await mergeVatImportIntoMonth({
    ...input,
    markApplied: true,
  });
  if (result.skipped && result.reason === "เดือนปิดงบแล้ว") {
    throw new Error("เดือนนี้ปิดงบแล้ว — ปลดล็อกก่อน");
  }
  if (result.skipped && result.mergedCount === 0 && result.preview.rowIds.length === 0) {
    throw new Error("ไม่มีแถวที่จะใช้เข้าเดือน");
  }
  return {
    preview: result.preview,
    saved: result.saved,
    appliedCount: result.mergedCount,
  };
}
