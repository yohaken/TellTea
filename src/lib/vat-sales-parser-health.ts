/**
 * Parser health + template-drift hints from platformEmailReports.
 */

import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_CHANNELS,
  type DeliveryChannel,
} from "./vat-sales";
import {
  listPlatformEmailReports,
  type PlatformEmailReport,
} from "./vat-sales-mail";

export type ChannelParserHealth = {
  channel: DeliveryChannel | "unknown";
  label: string;
  total: number;
  pending: number;
  ok: number;
  fail: number;
  confirmed: number;
  ignored: number;
  failRate: number | null;
  lastFailError: string;
  versions: string[];
  /** เคยมี ok/confirmed แล้ว fail ติดกันหลายฉบับ */
  driftSuspected: boolean;
};

export type ParserHealthSummary = {
  channels: ChannelParserHealth[];
  total: number;
  fail: number;
  failRate: number | null;
  driftChannels: Array<DeliveryChannel | "unknown">;
};

function emptyBucket(channel: DeliveryChannel | "unknown"): ChannelParserHealth {
  return {
    channel,
    label:
      channel === "unknown"
        ? "ไม่ทราบช่องทาง"
        : DELIVERY_CHANNEL_LABELS[channel],
    total: 0,
    pending: 0,
    ok: 0,
    fail: 0,
    confirmed: 0,
    ignored: 0,
    failRate: null,
    lastFailError: "",
    versions: [],
    driftSuspected: false,
  };
}

export function summarizeParserHealth(
  reports: PlatformEmailReport[],
  opts?: { driftFailStreak?: number },
): ParserHealthSummary {
  const driftFailStreak = opts?.driftFailStreak ?? 3;
  const map = new Map<DeliveryChannel | "unknown", ChannelParserHealth>();
  for (const ch of [...DELIVERY_CHANNELS, "unknown" as const]) {
    map.set(ch, emptyBucket(ch));
  }

  // newest first assumed from listPlatformEmailReports
  const streaks = new Map<DeliveryChannel | "unknown", number>();
  const hadSuccess = new Map<DeliveryChannel | "unknown", boolean>();

  for (const r of reports) {
    const ch = (r.channel || "unknown") as DeliveryChannel | "unknown";
    if (!map.has(ch)) map.set(ch, emptyBucket(ch));
    const b = map.get(ch)!;
    b.total += 1;
    if (r.parseStatus === "pending") b.pending += 1;
    else if (r.parseStatus === "ok") b.ok += 1;
    else if (r.parseStatus === "fail") {
      b.fail += 1;
      if (!b.lastFailError && r.parseError) b.lastFailError = r.parseError;
    } else if (r.parseStatus === "confirmed") b.confirmed += 1;
    else if (r.parseStatus === "ignored") b.ignored += 1;
    if (r.parserVersion && !b.versions.includes(r.parserVersion)) {
      b.versions.push(r.parserVersion);
    }

    if (r.parseStatus === "ok" || r.parseStatus === "confirmed") {
      hadSuccess.set(ch, true);
      streaks.set(ch, 0);
    } else if (r.parseStatus === "fail") {
      const n = (streaks.get(ch) || 0) + 1;
      streaks.set(ch, n);
      if ((hadSuccess.get(ch) || false) && n >= driftFailStreak) {
        b.driftSuspected = true;
      }
    }
  }

  const channels = [...map.values()]
    .filter((c) => c.total > 0)
    .map((c) => {
      const denom = c.ok + c.fail + c.confirmed;
      return {
        ...c,
        failRate: denom > 0 ? Math.round((c.fail / denom) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  const total = channels.reduce((s, c) => s + c.total, 0);
  const fail = channels.reduce((s, c) => s + c.fail, 0);
  const parsed = channels.reduce((s, c) => s + c.ok + c.fail + c.confirmed, 0);
  return {
    channels,
    total,
    fail,
    failRate: parsed > 0 ? Math.round((fail / parsed) * 1000) / 10 : null,
    driftChannels: channels.filter((c) => c.driftSuspected).map((c) => c.channel),
  };
}

export async function loadParserHealth(max = 200): Promise<ParserHealthSummary> {
  const reports = await listPlatformEmailReports({ max });
  return summarizeParserHealth(reports);
}
