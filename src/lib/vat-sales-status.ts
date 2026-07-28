/**
 * สถานะดำเนินงานรายวันสำหรับยอดขาย/VAT (derived)
 */

import {
  DELIVERY_CHANNELS,
  bangkokDateKey,
  type DailySalesDoc,
  type DeliveryChannel,
  type VatSalesSettings,
} from "./vat-sales";
import type { PlatformEmailReport } from "./vat-sales-mail";

export type DayOpsStatus =
  | "confirmed"
  | "pending_review"
  | "parse_error"
  | "missing_mail"
  | "incomplete"
  | "ready"
  | "empty";

export const DAY_OPS_STATUS_LABELS: Record<DayOpsStatus, string> = {
  confirmed: "OK",
  pending_review: "รอตรวจ",
  parse_error: "fail",
  missing_mail: "ขาดเมล",
  incomplete: "ไม่ครบ",
  ready: "พร้อม",
  empty: "—",
};

/** ย่อชื่อช่องทางในตาราง */
export const CHANNEL_SHORT: Record<DeliveryChannel, string> = {
  shopee: "Sp",
  grab: "G",
  lineman: "LM",
};

export function reportDateKey(r: PlatformEmailReport): string {
  return (r.parsed?.reportDate || r.reportDateGuess || "").trim();
}

export function groupReportsByDate(
  reports: PlatformEmailReport[],
): Record<string, PlatformEmailReport[]> {
  const out: Record<string, PlatformEmailReport[]> = {};
  for (const r of reports) {
    const key = reportDateKey(r);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (!out[key]) out[key] = [];
    out[key].push(r);
  }
  return out;
}

function enabledDeliveryChannels(settings: VatSalesSettings): DeliveryChannel[] {
  return DELIVERY_CHANNELS.filter((ch) => settings.channelsEnabled[ch] !== false);
}

function channelHasAmount(doc: DailySalesDoc, ch: DeliveryChannel): boolean {
  return (doc.delivery[ch]?.grossInclusive || 0) > 0 || Boolean(doc.emailRefs?.[ch]);
}

export function deriveDayOpsStatus(
  dateKey: string,
  doc: DailySalesDoc,
  emails: PlatformEmailReport[],
  settings: VatSalesSettings,
  todayKey = bangkokDateKey(),
): DayOpsStatus {
  if (doc.status === "confirmed") return "confirmed";

  const enabled = enabledDeliveryChannels(settings);
  const relevant = emails.filter((e) => {
    const kind = e.parsed?.reportKind || e.reportKind || "daily";
    if (kind !== "daily") return false;
    return e.channel === "unknown" || enabled.includes(e.channel as DeliveryChannel);
  });
  const hasPendingReview = relevant.some((e) => e.parseStatus === "ok");
  const hasParseFail = relevant.some((e) => e.parseStatus === "fail");
  const hasAnyMail = relevant.some((e) => e.parseStatus !== "ignored");

  if (hasPendingReview) return "pending_review";
  if (hasParseFail) return "parse_error";

  const filledDelivery = enabled.filter((ch) => channelHasAmount(doc, ch));
  const storefrontNeeded = settings.channelsEnabled.storefront !== false;
  const storefrontOk = !storefrontNeeded || (doc.storefrontGross || 0) > 0;

  const allDeliveryFilled = enabled.length === 0 || filledDelivery.length === enabled.length;
  // วันศูนย์ที่เมลยืนยันครบ (emailRefs) ก็พร้อมยืนยันได้
  const zeroDayFromMail =
    enabled.length > 0 &&
    filledDelivery.length === enabled.length &&
    enabled.every((ch) => Boolean(doc.emailRefs?.[ch]));
  if (
    allDeliveryFilled &&
    storefrontOk &&
    (doc.totalGross > 0 || zeroDayFromMail || enabled.length === 0)
  ) {
    return "ready";
  }

  const isPast = dateKey < todayKey;
  if (isPast && enabled.length > 0 && filledDelivery.length === 0 && !hasAnyMail) {
    return "missing_mail";
  }

  if (filledDelivery.length > 0 || (storefrontNeeded && (doc.storefrontGross || 0) > 0)) {
    return "incomplete";
  }

  if (isPast && enabled.length > 0 && !hasAnyMail) return "missing_mail";
  return "empty";
}

export type DayStatusCounts = Record<DayOpsStatus, number>;

export function emptyDayStatusCounts(): DayStatusCounts {
  return {
    confirmed: 0,
    pending_review: 0,
    parse_error: 0,
    missing_mail: 0,
    incomplete: 0,
    ready: 0,
    empty: 0,
  };
}

export function countDayStatuses(statuses: DayOpsStatus[]): DayStatusCounts {
  const c = emptyDayStatusCounts();
  for (const s of statuses) c[s] += 1;
  return c;
}

/** รายการที่ควรโชว์ในบล็อกต้องจัดการ */
export function actionNeededStatuses(): DayOpsStatus[] {
  return ["missing_mail", "pending_review", "parse_error", "incomplete"];
}

export function isActionNeeded(status: DayOpsStatus): boolean {
  return actionNeededStatuses().includes(status);
}
