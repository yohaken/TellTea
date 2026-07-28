/**
 * เทียบยอดสรุปแพลตฟอร์ม (สัปดาห์/เดือน) กับผลรวม dailySales — ไม่เขียนทับรายวัน
 */

import {
  dateKeysInMonth,
  isDateKey,
  isMonthKey,
  listDailySalesInMonth,
  roundMoney,
  type DeliveryChannel,
  type DailySalesDoc,
} from "./vat-sales";
import {
  listPlatformEmailReports,
  type PlatformEmailReport,
} from "./vat-sales-mail";

export type ReconcileRow = {
  report: PlatformEmailReport;
  channel: DeliveryChannel | "unknown";
  kind: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  platformGross: number;
  booksGross: number;
  diff: number;
  /** abs(diff) / platform ถ้ามี */
  diffPct: number | null;
  daysCounted: number;
};

function dateKeysInRange(start: string, end: string): string[] {
  if (!isDateKey(start) || !isDateKey(end) || start > end) return [];
  const out: string[] = [];
  const [ys, ms, ds] = start.split("-").map(Number);
  let cur = Date.UTC(ys, ms - 1, ds);
  const [ye, me, de] = end.split("-").map(Number);
  const endUtc = Date.UTC(ye, me - 1, de);
  while (cur <= endUtc) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(cur));
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
    out.push(`${get("year")}-${get("month")}-${get("day")}`);
    cur += 24 * 60 * 60 * 1000;
  }
  return out;
}

function sumChannelInDocs(
  docs: Record<string, DailySalesDoc>,
  keys: string[],
  channel: DeliveryChannel,
): { gross: number; days: number } {
  let gross = 0;
  let days = 0;
  for (const k of keys) {
    const d = docs[k];
    if (!d) continue;
    const g = d.delivery[channel]?.grossInclusive || 0;
    if (g > 0) {
      gross = roundMoney(gross + g);
      days += 1;
    }
  }
  return { gross, days };
}

export async function buildReconcileRows(opts?: {
  monthKey?: string;
}): Promise<ReconcileRow[]> {
  const all = await listPlatformEmailReports({ max: 300 });
  const summaries = all.filter((r) => {
    const kind = r.parsed?.reportKind || r.reportKind;
    if (kind !== "weekly" && kind !== "monthly") return false;
    if (r.parseStatus === "ignored") return false;
    if (!r.parsed && r.parseStatus !== "ok" && r.parseStatus !== "confirmed") {
      // still include if has gross in parsed only
      return false;
    }
    return Boolean(r.parsed?.grossInclusive || r.parsed);
  });

  const monthCache = new Map<string, Record<string, DailySalesDoc>>();
  const loadMonth = async (month: string) => {
    if (!monthCache.has(month)) {
      monthCache.set(month, await listDailySalesInMonth(month));
    }
    return monthCache.get(month)!;
  };

  const rows: ReconcileRow[] = [];
  for (const report of summaries) {
    const kind = (report.parsed?.reportKind || report.reportKind) as
      | "weekly"
      | "monthly";
    const periodEnd =
      report.parsed?.periodEnd ||
      report.parsed?.reportDate ||
      report.reportDateGuess;
    let periodStart = report.parsed?.periodStart || "";
    if (!periodStart && kind === "monthly" && isDateKey(periodEnd)) {
      periodStart = `${periodEnd.slice(0, 7)}-01`;
    }
    if (!isDateKey(periodStart) || !isDateKey(periodEnd)) continue;

    if (opts?.monthKey && isMonthKey(opts.monthKey)) {
      if (!periodStart.startsWith(opts.monthKey) && !periodEnd.startsWith(opts.monthKey)) {
        continue;
      }
    }

    const channel = report.channel;
    if (channel === "unknown") continue;

    const months = new Set<string>();
    for (const k of dateKeysInRange(periodStart, periodEnd)) {
      months.add(k.slice(0, 7));
    }
    const docs: Record<string, DailySalesDoc> = {};
    for (const m of months) {
      Object.assign(docs, await loadMonth(m));
    }
    const keys = dateKeysInRange(periodStart, periodEnd);
    const { gross: booksGross, days } = sumChannelInDocs(docs, keys, channel);
    const platformGross = report.parsed?.grossInclusive || 0;
    const diff = roundMoney(platformGross - booksGross);
    const diffPct =
      platformGross > 0 ? roundMoney((Math.abs(diff) / platformGross) * 10000) / 100 : null;

    rows.push({
      report,
      channel,
      kind,
      periodStart,
      periodEnd,
      platformGross,
      booksGross,
      diff,
      diffPct,
      daysCounted: days,
    });
  }

  rows.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  return rows;
}

/** helper export for tests */
export function _dateKeysInRange(start: string, end: string) {
  return dateKeysInRange(start, end);
}

export function _unusedDateKeysInMonth(month: string) {
  return dateKeysInMonth(month);
}
