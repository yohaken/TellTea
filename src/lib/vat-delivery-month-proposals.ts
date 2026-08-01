/**
 * D3 — ข้อเสนอเดือน (L3)
 * จัดกลุ่มเมลที่แท็กแล้วเป็นโครงต่อเดือน/ช่องทาง
 * ยังไม่แกะยอด · ยังไม่ทับ vatMonthlyReturns (L4)
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { DeliveryChannel } from "./vat-sales";
import { DELIVERY_CHANNELS } from "./vat-sales";
import type { PlatformEmailReport } from "./vat-sales-mail";
import { listPlatformEmailReports } from "./vat-sales-mail";

export const VAT_DELIVERY_MONTH_PROPOSALS_COL = "vatDeliveryMonthProposals";

export type DeliveryAmountProposal = {
  /** ยอดขายแอพ (รวม VAT) — D3 ยังเป็น null */
  appSales: number | null;
  /** ยอดโอน */
  transfer: number | null;
  /** คชจ.GP ไม่รวม VAT */
  gpExVat: number | null;
  /** VAT-ซื้อ จากบิล GP */
  gpVat: number | null;
};

export type ChannelProposalStrategy =
  | "daily-rollup"
  | "monthly-summary"
  | "mixed"
  | "unknown";

export type ChannelMonthProposal = {
  channel: DeliveryChannel;
  status: "empty" | "studying" | "proposed" | "ready";
  strategy: ChannelProposalStrategy;
  reportIds: string[];
  skipIds: string[];
  tagCounts: Record<string, number>;
  /** จำนวนวันที่มีเมลใช้ได้ (เดาจากวันที่รายงาน) */
  dayCount: number;
  amounts: DeliveryAmountProposal;
  /** D3 = none จนกว่า D4 อะแดปเตอร์ / มือ */
  amountsSource: "none" | "manual" | "adapter";
  note: string;
};

export type VatDeliveryMonthProposal = {
  monthKey: string;
  phase: "D3";
  status: "studying" | "ready" | "merged";
  channels: Record<DeliveryChannel, ChannelMonthProposal>;
  rebuiltAt: number;
  rebuiltBy: string;
  catalogReportCount: number;
};

export function emptyAmounts(): DeliveryAmountProposal {
  return { appSales: null, transfer: null, gpExVat: null, gpVat: null };
}

export function emptyChannelProposal(
  channel: DeliveryChannel,
): ChannelMonthProposal {
  return {
    channel,
    status: "empty",
    strategy: "unknown",
    reportIds: [],
    skipIds: [],
    tagCounts: {},
    dayCount: 0,
    amounts: emptyAmounts(),
    amountsSource: "none",
    note: "",
  };
}

/** เดาเดือนจากวันที่รายงาน / รับเมล (yyyy-mm) */
export function monthKeyFromReport(report: {
  reportDateGuess?: string;
  receivedAt?: number;
  parsed?: { reportDate?: string | null } | null;
}): string {
  const fromParsed = String(report.parsed?.reportDate || "").trim();
  if (/^\d{4}-\d{2}/.test(fromParsed)) return fromParsed.slice(0, 7);
  const guess = String(report.reportDateGuess || "").trim();
  if (/^\d{4}-\d{2}/.test(guess)) return guess.slice(0, 7);
  const ms = Number(report.receivedAt) || 0;
  if (!ms) return "";
  // Asia/Bangkok calendar month
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return y && m ? `${y}-${m}` : "";
}

export function dayKeyFromReport(report: {
  reportDateGuess?: string;
  receivedAt?: number;
  parsed?: { reportDate?: string | null } | null;
}): string {
  const fromParsed = String(report.parsed?.reportDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(fromParsed)) return fromParsed.slice(0, 10);
  const guess = String(report.reportDateGuess || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(guess)) return guess.slice(0, 10);
  const ms = Number(report.receivedAt) || 0;
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function inferStrategy(tags: string[]): ChannelProposalStrategy {
  const t = new Set(tags);
  const monthly =
    t.has("lm-สรุปเดือน") || t.has("sf-สรุปเดือน") || t.has("grab-สรุปเดือน");
  const daily =
    t.has("grab-รายวัน") ||
    t.has("lm-รายวัน-ขาย") ||
    t.has("lm-รายวัน-โอน") ||
    t.has("sf-โอนรายวัน");
  if (monthly && daily) return "mixed";
  if (monthly) return "monthly-summary";
  if (daily) return "daily-rollup";
  return "unknown";
}

function isSkip(tags: string[]): boolean {
  return tags.includes("ข้าม");
}

function emptyMonthProposal(monthKey: string): VatDeliveryMonthProposal {
  return {
    monthKey,
    phase: "D3",
    status: "studying",
    channels: {
      grab: emptyChannelProposal("grab"),
      lineman: emptyChannelProposal("lineman"),
      shopee: emptyChannelProposal("shopee"),
    },
    rebuiltAt: 0,
    rebuiltBy: "",
    catalogReportCount: 0,
  };
}

/** สร้างข้อเสนอเดือนจากแคตตาล็อกที่แท็กแล้ว — ไม่ใส่ยอด */
export function buildMonthProposalFromReports(
  monthKey: string,
  reports: PlatformEmailReport[],
  actor = "system",
): VatDeliveryMonthProposal {
  const out = emptyMonthProposal(monthKey);
  const inMonth = reports.filter((r) => monthKeyFromReport(r) === monthKey);
  out.catalogReportCount = inMonth.length;

  for (const ch of DELIVERY_CHANNELS) {
    const rows = inMonth.filter((r) => r.channel === ch);
    const tagCounts: Record<string, number> = {};
    const reportIds: string[] = [];
    const skipIds: string[] = [];
    const days = new Set<string>();
    const usefulTags: string[] = [];

    for (const r of rows) {
      const tags = r.studyTags || [];
      for (const t of tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
      if (isSkip(tags)) {
        skipIds.push(r.id);
        continue;
      }
      reportIds.push(r.id);
      usefulTags.push(...tags);
      const day = dayKeyFromReport(r);
      if (day) days.add(day);
    }

    const strategy = inferStrategy(usefulTags);
    let status: ChannelMonthProposal["status"] = "empty";
    if (reportIds.length) status = "studying";
    // D3: มีวัตถุดิบครบเชิงจำนวนวันแต่ยังไม่มียอด → proposed เมื่อมีอย่างน้อย 1 แถวใช้ได้
    if (reportIds.length >= 1) status = "proposed";

    let note = "";
    if (!reportIds.length && skipIds.length) {
      note = "มีเมลแต่ติดข้ามทั้งหมด";
    } else if (strategy === "daily-rollup") {
      note = `ม้วนรายวัน · ${days.size || reportIds.length} วัน · ยอดยังว่าง (รอ D4)`;
    } else if (strategy === "monthly-summary") {
      note = "สรุปเดือน · ยอดยังว่าง (รอ D4)";
    } else if (reportIds.length) {
      note = "รอจัดชนิดแท็ก / ยอดยังว่าง";
    }

    out.channels[ch] = {
      channel: ch,
      status,
      strategy,
      reportIds,
      skipIds,
      tagCounts,
      dayCount: days.size,
      amounts: emptyAmounts(),
      amountsSource: "none",
      note,
    };
  }

  const anyProposed = DELIVERY_CHANNELS.some(
    (ch) => out.channels[ch].status === "proposed",
  );
  out.status = anyProposed ? "studying" : "studying";
  out.rebuiltAt = Date.now();
  out.rebuiltBy = actor;
  return out;
}

export function proposalSummaryLine(p: VatDeliveryMonthProposal): string {
  const parts = DELIVERY_CHANNELS.map((ch) => {
    const c = p.channels[ch];
    const n = c.reportIds.length;
    if (!n && !c.skipIds.length) return `${ch}:—`;
    return `${ch}:${n}ใช้/${c.skipIds.length}ข้าม`;
  });
  return `${p.monthKey} · ${parts.join(" · ")} · ยอด=ยังว่าง`;
}

function mapProposal(
  monthKey: string,
  raw: Record<string, unknown>,
): VatDeliveryMonthProposal {
  const base = emptyMonthProposal(monthKey);
  const channelsRaw =
    raw.channels && typeof raw.channels === "object"
      ? (raw.channels as Record<string, Record<string, unknown>>)
      : {};
  for (const ch of DELIVERY_CHANNELS) {
    const c = channelsRaw[ch] || {};
    const amountsRaw =
      c.amounts && typeof c.amounts === "object"
        ? (c.amounts as Record<string, unknown>)
        : {};
    const numOrNull = (v: unknown) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    base.channels[ch] = {
      channel: ch,
      status:
        c.status === "ready" ||
        c.status === "proposed" ||
        c.status === "studying" ||
        c.status === "empty"
          ? c.status
          : "empty",
      strategy:
        c.strategy === "daily-rollup" ||
        c.strategy === "monthly-summary" ||
        c.strategy === "mixed" ||
        c.strategy === "unknown"
          ? c.strategy
          : "unknown",
      reportIds: Array.isArray(c.reportIds)
        ? c.reportIds.map(String).slice(0, 200)
        : [],
      skipIds: Array.isArray(c.skipIds)
        ? c.skipIds.map(String).slice(0, 200)
        : [],
      tagCounts:
        c.tagCounts && typeof c.tagCounts === "object"
          ? Object.fromEntries(
              Object.entries(c.tagCounts as Record<string, unknown>).map(
                ([k, v]) => [k, Number(v) || 0],
              ),
            )
          : {},
      dayCount: Number(c.dayCount) || 0,
      amounts: {
        appSales: numOrNull(amountsRaw.appSales),
        transfer: numOrNull(amountsRaw.transfer),
        gpExVat: numOrNull(amountsRaw.gpExVat),
        gpVat: numOrNull(amountsRaw.gpVat),
      },
      amountsSource:
        c.amountsSource === "manual" || c.amountsSource === "adapter"
          ? c.amountsSource
          : "none",
      note: String(c.note || "").slice(0, 400),
    };
  }
  return {
    ...base,
    status:
      raw.status === "ready" || raw.status === "merged" || raw.status === "studying"
        ? raw.status
        : "studying",
    rebuiltAt: Number(raw.rebuiltAt) || 0,
    rebuiltBy: String(raw.rebuiltBy || ""),
    catalogReportCount: Number(raw.catalogReportCount) || 0,
  };
}

export async function loadMonthProposal(
  monthKey: string,
): Promise<VatDeliveryMonthProposal | null> {
  const snap = await getDoc(
    doc(getDb(), VAT_DELIVERY_MONTH_PROPOSALS_COL, monthKey),
  );
  if (!snap.exists()) return null;
  return mapProposal(monthKey, (snap.data() || {}) as Record<string, unknown>);
}

export async function saveMonthProposal(
  proposal: VatDeliveryMonthProposal,
): Promise<void> {
  await setDoc(
    doc(getDb(), VAT_DELIVERY_MONTH_PROPOSALS_COL, proposal.monthKey),
    { ...proposal, phase: "D3" },
    { merge: true },
  );
}

export async function listMonthProposals(
  max = 18,
): Promise<VatDeliveryMonthProposal[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), VAT_DELIVERY_MONTH_PROPOSALS_COL),
      orderBy("monthKey", "desc"),
      limit(max),
    ),
  );
  return snap.docs.map((d) =>
    mapProposal(d.id, (d.data() || {}) as Record<string, unknown>),
  );
}

/** สแกนแคตตาล็อก → สร้าง/ทับข้อเสนอทุกเดือนที่พบ (ไม่แตะ L4) */
export async function rebuildMonthProposalsFromCatalog(opts?: {
  maxReports?: number;
  actor?: string;
  monthKeys?: string[];
}): Promise<{
  months: string[];
  proposals: VatDeliveryMonthProposal[];
  reportCount: number;
}> {
  const reports = await listPlatformEmailReports({
    max: opts?.maxReports || 300,
  });
  const monthSet = new Set<string>();
  for (const r of reports) {
    const mk = monthKeyFromReport(r);
    if (mk) monthSet.add(mk);
  }
  const months = (
    opts?.monthKeys?.length ? [...opts.monthKeys] : [...monthSet]
  )
    .filter(Boolean)
    .sort()
    .reverse();

  const proposals: VatDeliveryMonthProposal[] = [];
  for (const mk of months) {
    const p = buildMonthProposalFromReports(mk, reports, opts?.actor || "owner");
    await saveMonthProposal(p);
    proposals.push(p);
  }
  return { months, proposals, reportCount: reports.length };
}
