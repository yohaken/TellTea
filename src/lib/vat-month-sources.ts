/**
 * แหล่งยอด VAT แบบสรุปรายเดือน (ไม่ใช่รายวัน)
 * — Grab: ม้วนจากหลายไฟล์รายวัน → ยอดเดือน
 * — LINE MAN / Shopee: ไฟล์สรุปเดือนอยู่แล้ว
 * รายละเอียดรายวันค่อยแตกทีหลัง
 */
import { gpVatFromFee } from "./personal-income-tax";
import type { GrabCsvParseResult } from "./vat-import-grab-csv";
import type { LinemanMonthlyParseResult } from "./vat-import-lineman-monthly";
import { notifyVatImportMonthMerged } from "./vat-import-month-sync";
import {
  draftToSaveInput,
  MONTH_CHANNEL_LABEL,
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNELS,
  retToMonthBooksDraft,
  type MonthBooksDraft,
  type MonthChannel,
  patchGpFee,
  patchGpVat,
  patchSales,
  patchTransfer,
} from "./vat-month-books";
import {
  loadVatMonthlyReturn,
  saveVatMonthlyReturn,
  type VatMonthlyReturn,
} from "./vat-monthly";
import { normalizeMoney, roundMoney } from "./vat-sales";

/** ที่มาของยอดสรุปเดือนต่อช่องทาง */
export type MonthSourceKind =
  | "manual"
  | "grab-rollup"
  | "lineman-monthly"
  | "shopee-monthly";

export type MonthChannelSource = {
  channel: MonthChannel;
  /** ยอดขายรวม VAT → ภาษีขาย */
  sales: number;
  /** ยอดโอนถึงร้าน → รายได้ */
  transfer: number;
  /** คชจ. GP (อ้างอิง · อยู่ในโอนแล้ว) */
  fee: number;
  /** ภาษีซื้อ GP */
  gpVat: number;
  kind: MonthSourceKind;
  /** จำนวนวัน/ไฟล์ที่ม้วน (Grab) — 0 ถ้าไม่มี */
  dayCount: number;
  note: string;
};

export type MonthSourcesView = {
  monthKey: string;
  byChannel: Record<MonthChannel, MonthChannelSource>;
  totals: {
    sales: number;
    transfer: number;
    fee: number;
    gpVat: number;
  };
};

export const MONTH_SOURCE_KIND_LABEL: Record<MonthSourceKind, string> = {
  manual: "ใส่มือ",
  "grab-rollup": "ม้วนจากรายวัน",
  "lineman-monthly": "สรุปเดือน",
  "shopee-monthly": "สรุปเดือน",
};

/** คำอธิบายสั้นต่อช่องทาง — โชว์ในหน้าที่มา */
export const MONTH_CHANNEL_SOURCE_HINT: Record<MonthChannel, string> = {
  shopee: "Shopee — ไฟล์สรุปเดือน",
  grab: "Grab — ม้วนหลายไฟล์รายวัน → ยอดเดือน",
  lineman: "LINE MAN — รายงานสรุปเดือน",
};

/**
 * ความหมายคอลัมน์ยอดเดลิเวอรี่ (หลักบัญชี)
 * — ใช้ทั้งหน้า VAT เดือน (ตารางยอดเดลิเวอรี่) และหน้าที่มา · ให้คน/AI อ่านตรงกัน
 */
export const DELIVERY_COL_INFO = {
  appSales:
    "ยอดขายแอพ = ยอดขายที่แพลตฟอร์มรายงาน (รวม VAT) · ใช้คิดภาษีขาย",
  transfer:
    "ยอดโอน = ยอดเงินเข้าบัญชีธนาคารหลังหักค่า GP แล้ว · เป็นรายได้ถึงร้าน",
  gpFee:
    "คชจ.GP = ค่าบริการแพลตฟอร์มที่หักแวทออกแล้ว (ไม่รวม VAT) · อยู่ในยอดโอนแล้ว ไม่หักซ้ำกำไร",
  purchaseVat:
    "VAT-ซื้อ = แวทค่าบริการขาย (ภาษีซื้อจากบิลค่า GP) · ไม่ใช่เงินหักเพิ่มจากโอน",
} as const;

/**
 * คำอธิบายแหล่งที่มา (หน้าที่มายอดเดลิเวอรี่เท่านั้น — ไม่โชว์ในงบ VAT)
 * ให้คน/AI เข้าใจว่าไฟล์แต่ละช่องทางเข้าสู่ยอดเดือนอย่างไร
 */
export const DELIVERY_SOURCE_GUIDE = {
  overview:
    "หน้านี้รวบรวมยอดเดลิเวอรี่จากแหล่งจริง แล้วผสานเข้าตาราง「ยอดเดลิเวอรี่」ในหน้า VAT เดือนทันที",
  grab:
    "Grab: ได้หลายไฟล์รายวัน (CSV/เมล) → ม้วนรวมเป็นยอดเดือนก่อนเข้างบ · ยังไม่เก็บรายวันในงบ",
  lineman:
    "LINE MAN: มีรายงานสรุปเดือน (PDF) อยู่แล้ว → อ่านยอดรวมเดือนตรง ๆ",
  shopee:
    "Shopee: มีไฟล์สรุปเดือนอยู่แล้ว → อ่านยอดรวมเดือนตรง ๆ",
  sync:
    "แก้ยอดในหน้านี้แล้วบันทึกอัตโนมัติ → ตารางยอดเดลิเวอรี่หน้า VAT เดือนอัปเดตตาม",
  later:
    "รายละเอียดรายวัน / ใบกำกับ / อัปโหลดไฟล์อัตโนมัติ — พัฒนาทีหลังบนหน้านี้ (ไม่ปนหน้า VAT)",
} as const;

export function emptyChannelSource(
  channel: MonthChannel,
  kind?: MonthSourceKind,
): MonthChannelSource {
  const defaultKind: MonthSourceKind =
    kind ||
    (channel === "grab"
      ? "grab-rollup"
      : channel === "lineman"
        ? "lineman-monthly"
        : channel === "shopee"
          ? "shopee-monthly"
          : "manual");
  return {
    channel,
    sales: 0,
    transfer: 0,
    fee: 0,
    gpVat: 0,
    kind: defaultKind,
    dayCount: 0,
    note: "",
  };
}

/** อ่านยอดสรุปจากร่างงบเดือน */
export function draftToMonthSources(draft: MonthBooksDraft): MonthSourcesView {
  const byChannel = {} as Record<MonthChannel, MonthChannelSource>;
  for (const k of MONTH_CHANNELS) {
    byChannel[k] = {
      ...emptyChannelSource(k),
      sales: normalizeMoney(draft.sales[k]),
      transfer: normalizeMoney(draft.transfer[k]),
      fee: normalizeMoney(draft.gpFee[k]),
      gpVat: normalizeMoney(draft.gpVatOverride[k]),
      kind: "manual",
      note: "",
    };
  }
  return {
    monthKey: draft.monthKey,
    byChannel,
    totals: sumMonthSources(byChannel),
  };
}

export function sumMonthSources(
  byChannel: Record<MonthChannel, MonthChannelSource>,
): MonthSourcesView["totals"] {
  let sales = 0;
  let transfer = 0;
  let fee = 0;
  let gpVat = 0;
  for (const k of MONTH_CHANNELS) {
    const c = byChannel[k];
    sales = roundMoney(sales + c.sales);
    transfer = roundMoney(transfer + c.transfer);
    fee = roundMoney(fee + c.fee);
    gpVat = roundMoney(gpVat + c.gpVat);
  }
  return { sales, transfer, fee, gpVat };
}

/** เขียนยอดช่องทางหนึ่งเข้า draft งบเดือน */
export function applyChannelSourceToDraft(
  draft: MonthBooksDraft,
  source: MonthChannelSource,
): MonthBooksDraft {
  const k = source.channel;
  let next = patchSales(draft, k, source.sales);
  next = patchTransfer(next, k, source.transfer);
  next = patchGpFee(next, k, source.fee);
  next = patchGpVat(next, k, source.gpVat);
  return next;
}

/** เขียนทั้งชุดช่องทางเข้า draft */
export function applyMonthSourcesToDraft(
  draft: MonthBooksDraft,
  sources: MonthSourcesView,
): MonthBooksDraft {
  let next = draft;
  for (const k of MONTH_CHANNELS) {
    next = applyChannelSourceToDraft(next, sources.byChannel[k]);
  }
  return next;
}

export function patchMonthSourceField(
  source: MonthChannelSource,
  field: "sales" | "transfer" | "fee" | "gpVat",
  value: number,
): MonthChannelSource {
  return {
    ...source,
    [field]: normalizeMoney(value),
    kind: source.kind === "manual" ? "manual" : source.kind,
  };
}

/**
 * Grab CSV (หลายวัน/หลายไฟล์) → ยอดรวมเดือนหนึ่งช่องทาง
 * เรียกหลัง parseGrabTransactionCsv · รวม days เป็นก้อนเดียว
 */
export function grabCsvToMonthSource(
  parsed: GrabCsvParseResult,
): MonthChannelSource {
  let sales = 0;
  let transfer = 0;
  let fee = 0;
  for (const d of parsed.days) {
    sales = roundMoney(sales + d.grossInclusive);
    transfer = roundMoney(transfer + d.netTransfer);
    fee = roundMoney(fee + d.fee);
  }
  const gpVat =
    fee > 0
      ? gpVatFromFee(fee, "incVat", 7)
      : roundMoney(parsed.days.reduce((s, d) => s + d.gpVat, 0));
  return {
    channel: "grab",
    sales: normalizeMoney(sales),
    transfer: normalizeMoney(transfer),
    fee: normalizeMoney(fee),
    gpVat: normalizeMoney(gpVat),
    kind: "grab-rollup",
    dayCount: parsed.days.length,
    note:
      parsed.days.length > 0
        ? `ม้วน ${parsed.days.length} วันจาก Grab CSV`
        : "Grab CSV · ยังไม่มีวัน",
  };
}

/**
 * รวมผล Grab หลายไฟล์ (หลาย parse) เป็นยอดเดือนเดียว
 * — ใช้เมื่อมีเมล/ไฟล์รายวันหลายชุดในเดือนเดียวกัน
 */
export function mergeGrabMonthSources(
  parts: MonthChannelSource[],
): MonthChannelSource {
  let sales = 0;
  let transfer = 0;
  let fee = 0;
  let gpVat = 0;
  let dayCount = 0;
  for (const p of parts) {
    if (p.channel !== "grab") continue;
    sales = roundMoney(sales + p.sales);
    transfer = roundMoney(transfer + p.transfer);
    fee = roundMoney(fee + p.fee);
    gpVat = roundMoney(gpVat + p.gpVat);
    dayCount += p.dayCount;
  }
  return {
    channel: "grab",
    sales: normalizeMoney(sales),
    transfer: normalizeMoney(transfer),
    fee: normalizeMoney(fee),
    gpVat: normalizeMoney(gpVat),
    kind: "grab-rollup",
    dayCount,
    note: dayCount > 0 ? `ม้วนรวม ${dayCount} วันจากหลายไฟล์ Grab` : "",
  };
}

/** LINE MAN รายงานเดือน → ยอดรวมเดือน (ไม่แตกแถววัน) */
export function linemanMonthlyToMonthSource(
  parsed: LinemanMonthlyParseResult,
): MonthChannelSource {
  const fee = normalizeMoney(parsed.monthFeeInclVat);
  const sales = normalizeMoney(parsed.monthGross);
  // ยอดเงินในระบบ = ขาย − GP · ถ้ามีสรุปโอนธนาคารใช้เป็นอ้างอิงใน note
  const fromDays = parsed.days.reduce(
    (s, d) => roundMoney(s + d.systemBalance),
    0,
  );
  const transfer =
    sales > 0 && fee > 0
      ? normalizeMoney(Math.max(0, sales - fee))
      : normalizeMoney(fromDays);
  const gpVat = fee > 0 ? gpVatFromFee(fee, "incVat", 7) : 0;
  return {
    channel: "lineman",
    sales,
    transfer,
    fee,
    gpVat: normalizeMoney(gpVat),
    kind: "lineman-monthly",
    dayCount: 0,
    note: parsed.monthTransferOut
      ? `สรุปเดือน LM · โอนธนาคารอ้างอิง ${parsed.monthTransferOut.toFixed(2)}`
      : "สรุปเดือน LINE MAN",
  };
}

/**
 * Shopee สรุปเดือน (ใส่มือ/ไฟล์ทีหลัง) — helper สร้างโครง
 * ยังไม่มีอะแดปเตอร์ไฟล์ขายเดือนในรอบนี้
 */
export function shopeeMonthlySource(input: {
  sales?: number;
  transfer?: number;
  fee?: number;
  gpVat?: number;
  note?: string;
}): MonthChannelSource {
  const sales = normalizeMoney(input.sales || 0);
  const transfer = normalizeMoney(input.transfer || 0);
  const fee = normalizeMoney(input.fee || 0);
  const gpVat =
    input.gpVat != null && input.gpVat > 0
      ? normalizeMoney(input.gpVat)
      : fee > 0
        ? gpVatFromFee(fee, "incVat", 7)
        : 0;
  return {
    channel: "shopee",
    sales,
    transfer,
    fee,
    gpVat: normalizeMoney(gpVat),
    kind: "shopee-monthly",
    dayCount: 0,
    note: input.note || "สรุปเดือน Shopee",
  };
}

export function channelSourceLabel(channel: MonthChannel): string {
  return `${MONTH_CHANNEL_SHORT[channel]} · ${MONTH_CHANNEL_LABEL[channel]}`;
}

/**
 * ผสานยอดจากหน้าที่มา → vatMonthlyReturns แล้วแจ้งหน้า VAT เดือน
 * (filed = ข้าม · ไม่แก้)
 */
export async function mergeMonthSourcesIntoBooks(input: {
  monthKey: string;
  sources: MonthSourcesView;
  actor: string;
}): Promise<{
  saved: VatMonthlyReturn;
  skipped: boolean;
  reason?: string;
}> {
  const ret = await loadVatMonthlyReturn(input.monthKey);
  if (ret.status === "filed") {
    return { saved: ret, skipped: true, reason: "เดือนปิดงบแล้ว" };
  }
  const draft0 = retToMonthBooksDraft(ret);
  const next = applyMonthSourcesToDraft(draft0, {
    ...input.sources,
    monthKey: input.monthKey,
  });
  const saved = await saveVatMonthlyReturn(
    draftToSaveInput(next, ret.status === "saved" ? "saved" : "draft"),
    input.actor,
  );
  notifyVatImportMonthMerged(input.monthKey, saved);
  return { saved, skipped: false };
}

export { MONTH_CHANNELS, MONTH_CHANNEL_SHORT, MONTH_CHANNEL_LABEL };
