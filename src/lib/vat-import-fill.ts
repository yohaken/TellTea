/**
 * % ความครบของตารางนำเข้า วัน×ช่องทาง (SF/GB/LM)
 */
import { daysInMonthKey } from "./categories";
import type { VatImportRow } from "./vat-import";
import { isMonthKey, type DeliveryChannel } from "./vat-sales";

export const IMPORT_FILL_CHANNELS = [
  "shopee",
  "grab",
  "lineman",
] as const satisfies ReadonlyArray<DeliveryChannel>;

export type ChannelFillStat = {
  channel: DeliveryChannel;
  daysInMonth: number;
  /** วันที่มีอย่างน้อยหนึ่งยอด (ขาย/คชจ./โอน/GP≠) */
  daysFilled: number;
  pct: number;
};

export type ImportFillStats = {
  monthKey: string;
  daysInMonth: number;
  byChannel: Record<DeliveryChannel, ChannelFillStat>;
  /** เฉลี่ย % สามช่องทาง */
  overallPct: number;
  slotsTotal: number;
  slotsFilled: number;
};

function rowHasAmount(r: VatImportRow): boolean {
  return (
    r.grossInclusive > 0 || r.fee > 0 || r.netTransfer > 0 || r.gpVat > 0
  );
}

export function computeImportFillStats(
  monthKey: string,
  rows: VatImportRow[],
): ImportFillStats {
  const daysInMonth = isMonthKey(monthKey) ? daysInMonthKey(monthKey) : 0;
  const filledDays: Record<DeliveryChannel, Set<string>> = {
    shopee: new Set(),
    grab: new Set(),
    lineman: new Set(),
  };
  for (const r of rows) {
    if (r.monthKey !== monthKey) continue;
    if (r.status === "skipped") continue;
    if (r.channel === "storefront") continue;
    if (!rowHasAmount(r)) continue;
    if (r.channel === "shopee" || r.channel === "grab" || r.channel === "lineman") {
      filledDays[r.channel].add(r.dateKey);
    }
  }

  const byChannel = {} as Record<DeliveryChannel, ChannelFillStat>;
  let pctSum = 0;
  let slotsFilled = 0;
  for (const ch of IMPORT_FILL_CHANNELS) {
    const daysFilled = filledDays[ch].size;
    const pct =
      daysInMonth > 0 ? Math.round((daysFilled / daysInMonth) * 1000) / 10 : 0;
    byChannel[ch] = { channel: ch, daysInMonth, daysFilled, pct };
    pctSum += pct;
    slotsFilled += daysFilled;
  }
  const slotsTotal = daysInMonth * IMPORT_FILL_CHANNELS.length;
  const overallPct =
    IMPORT_FILL_CHANNELS.length > 0
      ? Math.round((pctSum / IMPORT_FILL_CHANNELS.length) * 10) / 10
      : 0;

  return {
    monthKey,
    daysInMonth,
    byChannel,
    overallPct,
    slotsTotal,
    slotsFilled,
  };
}

export function formatFillPct(pct: number): string {
  if (!Number.isFinite(pct)) return "0%";
  const n = Math.round(pct * 10) / 10;
  return Number.isInteger(n) ? `${n}%` : `${n}%`;
}
