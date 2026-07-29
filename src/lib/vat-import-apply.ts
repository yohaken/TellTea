/**
 * I5 — รวมแถวนำเข้าเข้าเดือน VAT (ยอดขาย / ยอดโอน / ภาษีซื้อ GP)
 */
import {
  deriveGpFromNetTransfer,
  mapGpByChannel,
  type GpByChannel,
  type GpChannelKey,
} from "./personal-income-tax";
import {
  loadVatMonthlyReturn,
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

function patchChannelGp(
  prev: GpByChannel,
  key: GpChannelKey,
  sum: ChannelApplySum,
): GpByChannel {
  const next = { ...prev, [key]: { ...prev[key] } };
  const hasSales = sum.salesCount > 0 && sum.gross > 0;
  const hasNet = sum.salesCount > 0; // รวมวันที่ยอดโอน = 0 ได้
  if (hasSales && hasNet) {
    const derived = deriveGpFromNetTransfer(sum.gross, sum.netTransfer);
    next[key] = {
      mode: "transfer",
      netTransfer: derived.netTransfer,
      amount: derived.deduct,
      pct: derived.pct,
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
 * เขียนเข้า vatMonthlyReturns/{month} + ตั้งแถวเป็น applied
 * - ยอดขายช่องทาง: ทับเฉพาะช่องที่มีแถว sales/gross
 * - ยอดโอน: โหมด transfer ต่อช่องทาง
 * - ภาษีซื้อ GP เดลิเวอรี่: Σ gpVat ของช่องทางเดลิเวอรี่ที่อยู่ในชุด apply
 *   (รวมกับ gpVat ช่องทางที่ไม่ได้แตะครั้งนี้ — เก็บของเดิม)
 */
export async function applyVatImportRowsToMonth(input: {
  monthKey: string;
  rows: VatImportRow[];
  actor: string;
}): Promise<{
  preview: ApplyVatImportPreview;
  saved: VatMonthlyReturn;
  appliedCount: number;
}> {
  const preview = previewApplyVatImportRows(input.monthKey, input.rows);
  if (preview.rowIds.length === 0) {
    throw new Error("ไม่มีแถวที่จะใช้เข้าเดือน");
  }
  const ret = await loadVatMonthlyReturn(input.monthKey);
  if (ret.status === "filed") {
    throw new Error("เดือนนี้ปิดงบแล้ว — ปลดล็อกก่อน");
  }

  const channels = { ...ret.delivery.channels };
  let gpMap = mapGpByChannel(ret.pnlGpByChannel);
  let touchedVat = false;

  for (const k of DELIVERY_KEYS) {
    const sum = preview.byChannel[k];
    if (sum.salesCount > 0 && sum.gross > 0) {
      channels[k] = sum.gross;
    }
    if (sum.salesCount > 0 || sum.gpVat > 0) {
      gpMap = patchChannelGp(gpMap, k, sum);
    }
    if (sum.gpVat > 0) touchedVat = true;
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
      pnlIncomeMode: ret.pnlIncomeMode,
      pnlIncome: ret.pnlIncome,
      pnlDeliveryGpDeduct: ret.pnlDeliveryGpDeduct,
      pnlDeliveryGpMode: "amount",
      pnlDeliveryGpPct: ret.pnlDeliveryGpPct,
      pnlGpByChannel: gpMap,
      status: ret.status === "saved" ? "saved" : "draft",
    },
    input.actor,
  );

  void saveVatMonthlySettings({ pnlGpByChannel: gpMap }, input.actor).catch(
    () => undefined,
  );

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

  return {
    preview,
    saved,
    appliedCount: preview.rowIds.length,
  };
}
