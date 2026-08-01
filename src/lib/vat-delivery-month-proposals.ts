/**
 * D3 — ข้อเสนอเดือน (L3)
 * จัดกลุ่มเมลที่แท็กแล้วเป็นโครงต่อเดือน/ช่องทาง
 * ยังไม่แกะยอด · ยังไม่ทับ vatMonthlyReturns (L4)
 */
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import type { DeliveryChannel } from "./vat-sales";
import { DELIVERY_CHANNELS, roundMoney } from "./vat-sales";
import type { PlatformEmailReport } from "./vat-sales-mail";
import { listPlatformEmailReports } from "./vat-sales-mail";
import {
  parseMailNetTransfer,
  parsePlatformEmail,
} from "./vat-sales-parse";
import { gpVatFromFee } from "./personal-income-tax";
import {
  applyChannelSourceToDraft,
  emptyChannelSource,
  sumMonthSources,
  type MonthChannelSource,
  type MonthSourcesView,
} from "./vat-month-sources";
import {
  draftToSaveInput,
  retToMonthBooksDraft,
  type MonthChannel,
} from "./vat-month-books";
import { loadVatMonthlyReturn, saveVatMonthlyReturn } from "./vat-monthly";
import { notifyVatImportMonthMerged } from "./vat-import-month-sync";

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

/**
 * แถวรายวัน — คอลัมน์เดียวกับงบเดลิเวอรี่
 * ยอดขายแอพ · ยอดโอน · คชจ.GP · VAT-ซื้อ
 * ระบบ/AI เติม · owner ซุ่มตรวจเท่านั้น
 */
export type ChannelDayAmount = {
  dateKey: string;
  appSales: number | null;
  transfer: number | null;
  gpExVat: number | null;
  gpVat: number | null;
  reportId: string;
  /** filled = ระบบใส่แล้ว · gap = มีเมลแต่ parse ไม่ได้ · ซุ่มตรวจ = พร้อมให้ owner ดู */
  status: "filled" | "gap" | "ซุ่มตรวจ";
};

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
  /** none → adapter/manual/drive-ai (F4) · ยังไม่ใช่ L4 */
  amountsSource: "none" | "manual" | "adapter" | "drive-ai";
  note: string;
  /** ไฟล์ Drive ที่ใช้ร่างยอด (F4) */
  driveFileIds: string[];
  /**
   * ตารางรายวัน (เมื่อไม่มีสรุปเดือน / ม้วนจากรายวัน)
   * key = YYYY-MM-DD · คอลัมน์เดียวกับ amounts เดือน
   */
  days: Record<string, ChannelDayAmount>;
};

export type VatDeliveryMonthProposal = {
  monthKey: string;
  phase: "D3" | "D4" | "F4";
  status: "studying" | "ready" | "merged";
  channels: Record<DeliveryChannel, ChannelMonthProposal>;
  rebuiltAt: number;
  rebuiltBy: string;
  catalogReportCount: number;
};

const CONFIRMABLE_SOURCES = new Set(["adapter", "drive-ai", "manual"]);

export function channelHasConfirmableAmounts(
  c: ChannelMonthProposal | undefined | null,
): boolean {
  if (!c) return false;
  return (
    CONFIRMABLE_SOURCES.has(c.amountsSource) &&
    c.amounts.appSales != null &&
    Number(c.amounts.appSales) > 0
  );
}

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
    driveFileIds: [],
    days: {},
  };
}

function dayAmtToFeeParts(gross: number, net: number, feeHint: number) {
  let fee = feeHint;
  if (fee <= 0 && gross > 0 && net > 0 && gross >= net) {
    fee = roundMoney(gross - net);
  }
  const feeR = roundMoney(fee);
  const gpVat = feeR > 0 ? gpVatFromFee(feeR, "incVat", 7) : 0;
  const gpExVat = feeR > 0 ? roundMoney(feeR - gpVat) : 0;
  return { gpExVat, gpVat, fee: feeR };
}

/** ม้วนตารางรายวัน → ยอดเดือน (4 คอลัมน์เดิม) */
export function rollupDayMapToAmounts(
  days: Record<string, ChannelDayAmount>,
): DeliveryAmountProposal & { filledDays: number; gapDays: number } {
  let appSales = 0;
  let transfer = 0;
  let gpExVat = 0;
  let gpVat = 0;
  let filledDays = 0;
  let gapDays = 0;
  for (const d of Object.values(days)) {
    if (d.status === "gap" || (d.appSales == null && d.transfer == null)) {
      gapDays += 1;
      continue;
    }
    filledDays += 1;
    appSales += Number(d.appSales) || 0;
    transfer += Number(d.transfer) || 0;
    gpExVat += Number(d.gpExVat) || 0;
    gpVat += Number(d.gpVat) || 0;
  }
  if (!filledDays) {
    return { ...emptyAmounts(), filledDays: 0, gapDays };
  }
  if (gpExVat <= 0 && gpVat <= 0 && appSales > 0 && transfer > 0 && appSales >= transfer) {
    const parts = dayAmtToFeeParts(appSales, transfer, 0);
    gpExVat = parts.gpExVat;
    gpVat = parts.gpVat;
  }
  return {
    appSales: roundMoney(appSales),
    transfer: roundMoney(transfer),
    gpExVat: roundMoney(gpExVat),
    gpVat: roundMoney(gpVat),
    filledDays,
    gapDays,
  };
}

export function sortedChannelDays(
  days: Record<string, ChannelDayAmount> | undefined | null,
): ChannelDayAmount[] {
  if (!days || typeof days !== "object") return [];
  return Object.values(days).sort((a, b) =>
    String(a.dateKey).localeCompare(String(b.dateKey)),
  );
}

function mapDayRow(raw: unknown, fallbackDate = ""): ChannelDayAmount | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const dateKey = String(d.dateKey || fallbackDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const statusRaw = String(d.status || "");
  const status: ChannelDayAmount["status"] =
    statusRaw === "gap" || statusRaw === "ซุ่มตรวจ" || statusRaw === "filled"
      ? statusRaw
      : Number(d.appSales) > 0 || Number(d.transfer) > 0
        ? "ซุ่มตรวจ"
        : "gap";
  return {
    dateKey,
    appSales:
      d.appSales == null || d.appSales === ""
        ? null
        : roundMoney(Number(d.appSales) || 0),
    transfer:
      d.transfer == null || d.transfer === ""
        ? null
        : roundMoney(Number(d.transfer) || 0),
    gpExVat:
      d.gpExVat == null || d.gpExVat === ""
        ? null
        : roundMoney(Number(d.gpExVat) || 0),
    gpVat:
      d.gpVat == null || d.gpVat === ""
        ? null
        : roundMoney(Number(d.gpVat) || 0),
    reportId: String(d.reportId || "").slice(0, 120),
    status,
  };
}

/** เดาเดือนจากช่วงในเนื้อ / วันที่รายงาน / รับเมล (yyyy-mm) */
export function monthKeyFromReport(report: {
  periodMonthKey?: string;
  periodEnd?: string;
  reportDateGuess?: string;
  receivedAt?: number;
  parsed?: { reportDate?: string | null } | null;
}): string {
  const periodMk = String(report.periodMonthKey || "").trim();
  if (/^\d{4}-\d{2}$/.test(periodMk)) return periodMk;
  const periodEnd = String(report.periodEnd || "").trim();
  if (/^\d{4}-\d{2}/.test(periodEnd)) return periodEnd.slice(0, 7);
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

type DayAmt = { gross: number; fee: number; net: number; ok: boolean };

function parseReportAmounts(
  r: PlatformEmailReport,
  mode: "full" | "net-only" = "full",
): DayAmt {
  if (mode === "net-only") {
    if (r.parsed && r.parsed.netTransfer > 0) {
      return { gross: 0, fee: 0, net: r.parsed.netTransfer, ok: true };
    }
    if (r.channel === "unknown") {
      return { gross: 0, fee: 0, net: 0, ok: false };
    }
    const net = parseMailNetTransfer({
      channel: r.channel,
      subject: r.subject,
      rawText: r.rawText,
      rawHtml: r.rawHtml,
    });
    if (!net.ok) return { gross: 0, fee: 0, net: 0, ok: false };
    return { gross: 0, fee: 0, net: net.netTransfer, ok: true };
  }

  if (
    r.parsed &&
    (r.parsed.grossInclusive > 0 || r.parsed.netTransfer > 0)
  ) {
    return {
      gross: r.parsed.grossInclusive || 0,
      fee: r.parsed.fee || 0,
      net: r.parsed.netTransfer || 0,
      ok: true,
    };
  }
  if (r.channel === "unknown") {
    return { gross: 0, fee: 0, net: 0, ok: false };
  }
  const res = parsePlatformEmail({
    channel: r.channel,
    subject: r.subject,
    rawText: r.rawText,
    rawHtml: r.rawHtml,
    reportDateGuess: r.reportDateGuess,
    receivedAt: r.receivedAt,
  });
  if (!res.ok || !res.parsed) {
    // ลองยอดโอนอย่างเดียวถ้า full parse ไม่ผ่าน
    const net = parseMailNetTransfer({
      channel: r.channel,
      subject: r.subject,
      rawText: r.rawText,
      rawHtml: r.rawHtml,
    });
    if (net.ok) {
      return { gross: 0, fee: 0, net: net.netTransfer, ok: true };
    }
    return { gross: 0, fee: 0, net: 0, ok: false };
  }
  return {
    gross: res.parsed.grossInclusive || 0,
    fee: res.parsed.fee || 0,
    net: res.parsed.netTransfer || 0,
    ok: true,
  };
}

function rollupToAmounts(
  days: DayAmt[],
): DeliveryAmountProposal & { parsedOk: number; parsedFail: number } {
  let appSales = 0;
  let transfer = 0;
  let fee = 0;
  let parsedOk = 0;
  let parsedFail = 0;
  for (const d of days) {
    if (!d.ok) {
      parsedFail += 1;
      continue;
    }
    parsedOk += 1;
    appSales += d.gross;
    transfer += d.net;
    fee += d.fee;
  }
  if (fee <= 0 && appSales > 0 && transfer > 0 && appSales >= transfer) {
    fee = appSales - transfer;
  }
  const feeR = roundMoney(fee);
  const gpVat = feeR > 0 ? gpVatFromFee(feeR, "incVat", 7) : 0;
  const gpExVat = feeR > 0 ? roundMoney(feeR - gpVat) : 0;
  return {
    appSales: parsedOk ? roundMoney(appSales) : null,
    transfer: parsedOk ? roundMoney(transfer) : null,
    gpExVat: parsedOk && feeR > 0 ? gpExVat : parsedOk ? 0 : null,
    gpVat: parsedOk && feeR > 0 ? gpVat : parsedOk ? 0 : null,
    parsedOk,
    parsedFail,
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
      driveFileIds: [],
      days: {},
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
    const amt =
      c.amounts.appSales != null
        ? `ยอด${Math.round(c.amounts.appSales)}`
        : "ยอดว่าง";
    return `${ch}:${n}ใช้/${c.skipIds.length}ข้าม/${amt}`;
  });
  return `${p.monthKey} · ${p.phase} · ${parts.join(" · ")}`;
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
        c.amountsSource === "manual" ||
        c.amountsSource === "adapter" ||
        c.amountsSource === "drive-ai"
          ? c.amountsSource
          : "none",
      note: String(c.note || "").slice(0, 400),
      driveFileIds: Array.isArray(c.driveFileIds)
        ? c.driveFileIds.map(String).filter(Boolean).slice(0, 40)
        : [],
      days: (() => {
        const out: Record<string, ChannelDayAmount> = {};
        const rawDays = c.days && typeof c.days === "object" ? c.days : {};
        for (const [dk, row] of Object.entries(
          rawDays as Record<string, unknown>,
        )) {
          const mapped = mapDayRow(row, dk);
          if (mapped) out[mapped.dateKey] = mapped;
        }
        return out;
      })(),
    };
  }
  return {
    ...base,
    phase: raw.phase === "F4" ? "F4" : raw.phase === "D4" ? "D4" : "D3",
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
    { ...proposal },
    { merge: true },
  );
}

export async function listMonthProposals(
  max = 18,
): Promise<VatDeliveryMonthProposal[]> {
  // ไม่ใช้ orderBy — กันพังถ้ายังไม่มี index / ฟิลด์
  const snap = await getDocs(
    collection(getDb(), VAT_DELIVERY_MONTH_PROPOSALS_COL),
  );
  return snap.docs
    .map((d) => mapProposal(d.id, (d.data() || {}) as Record<string, unknown>))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .slice(0, max);
}

/**
 * สร้างตารางรายวัน (4 คอลัมน์) จากเมล — ระบบเติม · ไม่ให้ owner กรอก
 * คอลัมน์: ยอดขายแอพ · ยอดโอน · คชจ.GP · VAT-ซื้อ
 */
export function buildChannelDayMapFromReports(
  channel: DeliveryChannel,
  reports: PlatformEmailReport[],
  monthKey: string,
): Record<string, ChannelDayAmount> {
  const days: Record<string, ChannelDayAmount> = {};

  if (channel === "lineman") {
    const salesByDay = new Map<string, { gross: number; fee: number; id: string }>();
    const transferByDay = new Map<string, { net: number; id: string }>();
    for (const r of reports) {
      const dk = dayKeyFromReport(r);
      if (!dk || !dk.startsWith(monthKey)) continue;
      const tags = r.studyTags || [];
      if (tags.includes("ข้าม")) continue;
      if (tags.includes("lm-รายวัน-โอน") || /ยอดโอนออก/.test(r.subject)) {
        const amt = parseReportAmounts(r, "net-only");
        if (amt.ok) {
          const prev = transferByDay.get(dk);
          transferByDay.set(dk, {
            net: roundMoney((prev?.net || 0) + amt.net),
            id: r.id,
          });
        } else if (!transferByDay.has(dk)) {
          transferByDay.set(dk, { net: 0, id: r.id });
        }
        continue;
      }
      const amt = parseReportAmounts(r, "full");
      if (amt.ok) {
        const prev = salesByDay.get(dk);
        salesByDay.set(dk, {
          gross: roundMoney((prev?.gross || 0) + amt.gross),
          fee: roundMoney((prev?.fee || 0) + amt.fee),
          id: r.id,
        });
      } else if (!salesByDay.has(dk)) {
        salesByDay.set(dk, { gross: 0, fee: 0, id: r.id });
      }
    }
    const allKeys = new Set([...salesByDay.keys(), ...transferByDay.keys()]);
    for (const dk of allKeys) {
      const s = salesByDay.get(dk);
      const t = transferByDay.get(dk);
      const gross = s?.gross || 0;
      const net = t?.net || 0;
      const parts = dayAmtToFeeParts(gross, net, s?.fee || 0);
      const ok = gross > 0 || net > 0;
      days[dk] = {
        dateKey: dk,
        appSales: ok ? gross : null,
        transfer: ok ? net : null,
        gpExVat: ok ? parts.gpExVat : null,
        gpVat: ok ? parts.gpVat : null,
        reportId: s?.id || t?.id || "",
        status: ok ? "ซุ่มตรวจ" : "gap",
      };
    }
    return days;
  }

  for (const r of reports) {
    const dk = dayKeyFromReport(r);
    if (!dk || !dk.startsWith(monthKey)) continue;
    if ((r.studyTags || []).includes("ข้าม")) continue;
    const amt = parseReportAmounts(r, "full");
    const prev = days[dk];
    if (!amt.ok) {
      if (!prev) {
        days[dk] = {
          dateKey: dk,
          appSales: null,
          transfer: null,
          gpExVat: null,
          gpVat: null,
          reportId: r.id,
          status: "gap",
        };
      }
      continue;
    }
    const gross = roundMoney((prev?.appSales || 0) + amt.gross);
    const net = roundMoney((prev?.transfer || 0) + amt.net);
    const parts = dayAmtToFeeParts(gross, net, (prev ? Number(prev.gpExVat) + Number(prev.gpVat) : 0) + amt.fee);
    days[dk] = {
      dateKey: dk,
      appSales: gross,
      transfer: net,
      gpExVat: parts.gpExVat,
      gpVat: parts.gpVat,
      reportId: r.id,
      status: "ซุ่มตรวจ",
    };
  }
  return days;
}

/**
 * เติมยอดในข้อเสนอจาก parse เมล (L3 เท่านั้น · ไม่ทับงบ L4)
 * สร้างตารางรายวัน 4 คอลัมน์ แล้วม้วนเป็นยอดเดือน
 * Grab/Shopee/LM = ม้วนรายวันเมื่อไม่มีสรุปเดือน
 */
export function fillProposalAmountsFromReports(
  proposal: VatDeliveryMonthProposal,
  reports: PlatformEmailReport[],
  actor = "system",
): VatDeliveryMonthProposal {
  const byId = new Map(reports.map((r) => [r.id, r]));
  const next: VatDeliveryMonthProposal = {
    ...proposal,
    phase: "D4",
    channels: { ...proposal.channels },
    rebuiltAt: Date.now(),
    rebuiltBy: actor,
  };

  for (const ch of DELIVERY_CHANNELS) {
    const prev = proposal.channels[ch];
    const useful = prev.reportIds
      .map((id) => byId.get(id))
      .filter((r): r is PlatformEmailReport => Boolean(r));

    const dayMap = buildChannelDayMapFromReports(
      ch,
      useful,
      proposal.monthKey,
    );
    const roll = rollupDayMapToAmounts(dayMap);
    const has = roll.filledDays > 0 && roll.appSales != null && Number(roll.appSales) > 0;
    const isMonthly = prev.strategy === "monthly-summary";
    next.channels[ch] = {
      ...prev,
      days: dayMap,
      dayCount: Object.keys(dayMap).length || prev.dayCount,
      amounts: has
        ? {
            appSales: roll.appSales,
            transfer: roll.transfer,
            gpExVat: roll.gpExVat,
            gpVat: roll.gpVat,
          }
        : emptyAmounts(),
      amountsSource: has ? "adapter" : "none",
      status: has ? "ready" : prev.status,
      driveFileIds: prev.driveFileIds || [],
      note: has
        ? (isMonthly ? "D4 จากสรุป/รายวัน" : "D4 ตารางรายวัน") +
          ` · ${roll.filledDays} วัน` +
          (roll.gapDays ? ` · ช่องว่าง ${roll.gapDays}` : "") +
          " · ระบบเติม · รอซุ่มตรวจ · ยังไม่ทับงบ"
        : useful.length
          ? `D4 ยังไม่มียอด · gap ${roll.gapDays || useful.length} (รอ AI adapter / ซิงก์ไฟล์)`
          : prev.note || "ไม่มีเมลใช้ได้",
    };
  }

  const anyReady = DELIVERY_CHANNELS.some(
    (ch) => next.channels[ch].status === "ready",
  );
  next.status = anyReady ? "ready" : "studying";
  return next;
}

/** สแกนแคตตาล็อก → สร้าง/ทับข้อเสนอทุกเดือนที่พบ (ไม่แตะ L4) */
export async function rebuildMonthProposalsFromCatalog(opts?: {
  maxReports?: number;
  actor?: string;
  monthKeys?: string[];
  /** true = เติมยอดจาก parse เมลเข้า L3 (D4) */
  fillAmounts?: boolean;
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

  const actor = opts?.actor || "owner";
  const proposals: VatDeliveryMonthProposal[] = [];
  for (const mk of months) {
    let p = buildMonthProposalFromReports(mk, reports, actor);
    if (opts?.fillAmounts) {
      p = fillProposalAmountsFromReports(p, reports, actor);
    }
    await saveMonthProposal(p);
    proposals.push(p);
  }
  return { months, proposals, reportCount: reports.length };
}

/** แปลงข้อเสนอ L3 → ยอดสำหรับผสานงบ (เฉพาะช่องที่พร้อมยืนยัน) */
export function proposalToMonthSources(
  proposal: VatDeliveryMonthProposal,
): MonthSourcesView {
  const byChannel = {} as Record<MonthChannel, MonthChannelSource>;
  for (const ch of DELIVERY_CHANNELS) {
    const c = proposal.channels[ch];
    const has = channelHasConfirmableAmounts(c);
    const kind =
      ch === "grab"
        ? "grab-rollup"
        : ch === "lineman"
          ? c.strategy === "monthly-summary"
            ? "lineman-monthly"
            : "manual"
          : c.strategy === "monthly-summary"
            ? "shopee-monthly"
            : "manual";
    byChannel[ch] = {
      ...emptyChannelSource(ch, kind),
      sales: has ? Number(c.amounts.appSales) || 0 : 0,
      transfer: has ? Number(c.amounts.transfer) || 0 : 0,
      fee: has ? Number(c.amounts.gpExVat) || 0 : 0,
      gpVat: has ? Number(c.amounts.gpVat) || 0 : 0,
      dayCount: c.dayCount,
      note: has
        ? `จากข้อเสนอ ${proposal.phase} · ${c.note || ""}`.trim()
        : "",
    };
  }
  return {
    monthKey: proposal.monthKey,
    byChannel,
    totals: sumMonthSources(byChannel),
  };
}

export type DriveAiChannelDraft = {
  /** ยอดเดือน — ถ้าส่ง days จะม้วนจากรายวันแทน */
  appSales?: number | null;
  transfer?: number | null;
  gpExVat?: number | null;
  gpVat?: number | null;
  driveFileIds?: string[];
  note?: string;
  /** แถวรายวันจาก AI adapter — คอลัมน์เดียวกับงบ */
  days?: Array<{
    dateKey: string;
    appSales?: number | null;
    transfer?: number | null;
    gpExVat?: number | null;
    gpVat?: number | null;
    reportId?: string;
  }>;
};

/** F4 — ใส่ร่างยอดจาก AI/adapter ลง L3 เท่านั้น · ไม่ทับงบ · owner ไม่กรอก */
export function applyDriveAiDraftToProposal(
  proposal: VatDeliveryMonthProposal,
  drafts: Partial<Record<DeliveryChannel, DriveAiChannelDraft>>,
  actor = "ai",
): VatDeliveryMonthProposal {
  const next: VatDeliveryMonthProposal = {
    ...proposal,
    phase: "F4",
    channels: { ...proposal.channels },
    rebuiltAt: Date.now(),
    rebuiltBy: actor,
  };

  for (const ch of DELIVERY_CHANNELS) {
    const d = drafts[ch];
    if (!d) continue;
    const prev = proposal.channels[ch];

    let dayMap: Record<string, ChannelDayAmount> = { ...(prev.days || {}) };
    if (Array.isArray(d.days) && d.days.length) {
      dayMap = {};
      for (const row of d.days) {
        const mapped = mapDayRow(
          {
            dateKey: row.dateKey,
            appSales: row.appSales,
            transfer: row.transfer,
            gpExVat: row.gpExVat,
            gpVat: row.gpVat,
            reportId: row.reportId || "",
            status:
              Number(row.appSales) > 0 || Number(row.transfer) > 0
                ? "ซุ่มตรวจ"
                : "gap",
          },
          row.dateKey,
        );
        if (!mapped) continue;
        if (
          mapped.gpExVat == null &&
          mapped.gpVat == null &&
          mapped.appSales != null &&
          mapped.transfer != null
        ) {
          const parts = dayAmtToFeeParts(
            mapped.appSales,
            mapped.transfer,
            0,
          );
          mapped.gpExVat = parts.gpExVat;
          mapped.gpVat = parts.gpVat;
        }
        dayMap[mapped.dateKey] = mapped;
      }
    }

    const fromDays = Object.keys(dayMap).length
      ? rollupDayMapToAmounts(dayMap)
      : null;

    const appSales =
      fromDays?.appSales != null
        ? fromDays.appSales
        : d.appSales == null || !Number.isFinite(Number(d.appSales))
          ? null
          : roundMoney(Number(d.appSales));
    const transfer =
      fromDays?.transfer != null
        ? fromDays.transfer
        : d.transfer == null || !Number.isFinite(Number(d.transfer))
          ? null
          : roundMoney(Number(d.transfer));
    let gpExVat =
      fromDays?.gpExVat != null
        ? fromDays.gpExVat
        : d.gpExVat == null || !Number.isFinite(Number(d.gpExVat))
          ? null
          : roundMoney(Number(d.gpExVat));
    let gpVat =
      fromDays?.gpVat != null
        ? fromDays.gpVat
        : d.gpVat == null || !Number.isFinite(Number(d.gpVat))
          ? null
          : roundMoney(Number(d.gpVat));
    if (
      gpExVat == null &&
      gpVat == null &&
      appSales != null &&
      transfer != null &&
      appSales >= transfer
    ) {
      const parts = dayAmtToFeeParts(appSales, transfer, 0);
      gpVat = parts.gpVat;
      gpExVat = parts.gpExVat;
    }
    const has = appSales != null && appSales > 0;
    const dayCount = Object.keys(dayMap).length;
    next.channels[ch] = {
      ...prev,
      days: dayMap,
      dayCount: dayCount || prev.dayCount,
      amounts: has
        ? {
            appSales,
            transfer: transfer ?? 0,
            gpExVat: gpExVat ?? 0,
            gpVat: gpVat ?? 0,
          }
        : emptyAmounts(),
      amountsSource: has ? "drive-ai" : "none",
      status: has ? "ready" : prev.status,
      driveFileIds: Array.isArray(d.driveFileIds)
        ? d.driveFileIds.map(String).filter(Boolean).slice(0, 40)
        : prev.driveFileIds || [],
      note: has
        ? String(
            d.note ||
              (dayCount
                ? `F4 จากตารางรายวัน ${fromDays?.filledDays || dayCount} วัน · AI adapter · รอซุ่มตรวจ · ยังไม่ทับงบ`
                : "F4 ร่างจากไฟล์ Drive · รอซุ่มตรวจ · ยังไม่ทับงบ"),
          ).slice(0, 400)
        : String(d.note || prev.note || "").slice(0, 400),
    };
  }

  const anyReady = DELIVERY_CHANNELS.some((ch) =>
    channelHasConfirmableAmounts(next.channels[ch]),
  );
  next.status = anyReady ? "ready" : "studying";
  return next;
}

/**
 * F4 สำรองบนเว็บ — สร้างข้อเสนอจากเมลที่มีไฟล์ Drive แล้วเติมยอด parse
 * (แท็ก drive-ai · ยังไม่ทับ L4)
 */
export async function draftDriveMonthProposal(opts: {
  monthKey: string;
  actor: string;
}): Promise<VatDeliveryMonthProposal> {
  const reports = await listPlatformEmailReports({ max: 400 });
  const monthReports = reports.filter(
    (r) => monthKeyFromReport(r) === opts.monthKey,
  );
  // Drive เป็นกองรวม — ดึงไฟล์ที่ดัชนีชี้เดือนนี้ด้วย แม้เมลเคยเดาเดือนผิด
  const withDrive = reports.filter((r) =>
    (r.driveFiles || []).some(
      (f) =>
        f.monthKey === opts.monthKey ||
        monthKeyFromReport(r) === opts.monthKey,
    ),
  );
  const forAmounts = withDrive.length
    ? [
        ...monthReports,
        ...withDrive.filter(
          (r) => !monthReports.some((m) => m.id === r.id),
        ),
      ]
    : monthReports;
  const base = buildMonthProposalFromReports(
    opts.monthKey,
    forAmounts.length ? forAmounts : monthReports,
    opts.actor,
  );
  let filled = fillProposalAmountsFromReports(
    base,
    forAmounts.length ? forAmounts : monthReports,
    opts.actor,
  );

  const drafts: Partial<Record<DeliveryChannel, DriveAiChannelDraft>> = {};
  for (const ch of DELIVERY_CHANNELS) {
    const c = filled.channels[ch];
    if (!channelHasConfirmableAmounts(c)) continue;
    const allFiles = reports
      .filter((r) => r.channel === ch)
      .flatMap((r) => r.driveFiles || []);
    const preferred = allFiles.filter((f) => f.monthKey === opts.monthKey);
    const rest = allFiles.filter((f) => f.monthKey !== opts.monthKey);
    const fileIds = [...preferred, ...rest]
      .map((f) => f.fileId)
      .filter(Boolean)
      .slice(0, 40);
    drafts[ch] = {
      appSales: c.amounts.appSales,
      transfer: c.amounts.transfer,
      gpExVat: c.amounts.gpExVat,
      gpVat: c.amounts.gpVat,
      driveFileIds: fileIds,
      note:
        `F4 จากไฟล์ Drive (${fileIds.length} ไฟล์)` +
        (withDrive.length ? "" : " · ยังไม่มีไฟล์ Drive ใช้แคตตาล็อกเมล") +
        " · ยังไม่ทับงบ",
    };
  }

  filled = applyDriveAiDraftToProposal(filled, drafts, opts.actor);
  await saveMonthProposal(filled);
  return filled;
}

/**
 * F5 — ผสานข้อเสนอเดือนเข้า vatMonthlyReturns (L4)
 * เฉพาะช่องที่มียอดพร้อมยืนยัน · ไม่ทับช่องที่ยอดข้อเสนอว่าง
 */
export async function mergeProposalIntoBooks(opts: {
  monthKey: string;
  actor: string;
  /** ถ้าไม่ส่ง จะโหลดจาก Firestore */
  proposal?: VatDeliveryMonthProposal;
  channels?: DeliveryChannel[];
}): Promise<{
  saved: boolean;
  skipped: boolean;
  reason?: string;
  mergedChannels: DeliveryChannel[];
  proposal: VatDeliveryMonthProposal | null;
}> {
  const proposal =
    opts.proposal || (await loadMonthProposal(opts.monthKey));
  if (!proposal) {
    return {
      saved: false,
      skipped: true,
      reason: "ยังไม่มีข้อเสนอเดือนนี้ — สร้าง/เติมยอดก่อน",
      mergedChannels: [],
      proposal: null,
    };
  }

  const want = new Set(
    opts.channels?.length ? opts.channels : DELIVERY_CHANNELS,
  );
  const sources = proposalToMonthSources(proposal);
  const mergedChannels: DeliveryChannel[] = [];

  // ล้างช่องที่ไม่ได้ผสานออกจาก sources (ไม่เขียนทับด้วย 0)
  for (const ch of DELIVERY_CHANNELS) {
    const c = proposal.channels[ch];
    const has = want.has(ch) && channelHasConfirmableAmounts(c);
    if (!has) {
      sources.byChannel[ch] = {
        ...emptyChannelSource(ch),
        // ส่งค่าติดลบพิเศษไม่ได้ — ใช้ merge แบบทีละช่องแทน
      };
    } else {
      mergedChannels.push(ch);
    }
  }

  if (!mergedChannels.length) {
    return {
      saved: false,
      skipped: true,
      reason: "ไม่มีช่องที่มียอดพร้อมผสาน",
      mergedChannels: [],
      proposal,
    };
  }

  // ผสานทีละช่อง — ไม่ทับช่องอื่นด้วยศูนย์
  const ret = await loadVatMonthlyReturn(opts.monthKey);
  if (ret.status === "filed") {
    return {
      saved: false,
      skipped: true,
      reason: "เดือนปิดงบแล้ว",
      mergedChannels: [],
      proposal,
    };
  }

  let draft = retToMonthBooksDraft(ret);
  for (const ch of mergedChannels) {
    draft = applyChannelSourceToDraft(draft, sources.byChannel[ch]);
  }
  const saved = await saveVatMonthlyReturn(
    draftToSaveInput(draft, ret.status === "saved" ? "saved" : "draft"),
    opts.actor,
  );
  notifyVatImportMonthMerged(opts.monthKey, saved);

  const nextProp: VatDeliveryMonthProposal = {
    ...proposal,
    status: "merged",
    rebuiltAt: Date.now(),
    rebuiltBy: opts.actor,
    channels: { ...proposal.channels },
  };
  for (const ch of mergedChannels) {
    nextProp.channels[ch] = {
      ...nextProp.channels[ch],
      status: "ready",
      note: `${nextProp.channels[ch].note} · ผสานงบแล้ว`.trim(),
    };
  }
  await saveMonthProposal(nextProp);

  return {
    saved: true,
    skipped: false,
    mergedChannels,
    proposal: nextProp,
  };
}
