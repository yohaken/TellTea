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
import { parsePlatformEmail } from "./vat-sales-parse";
import { gpVatFromFee } from "./personal-income-tax";

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
  phase: "D3" | "D4";
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

type DayAmt = { gross: number; fee: number; net: number; ok: boolean };

function parseReportAmounts(r: PlatformEmailReport): DayAmt {
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
        c.amountsSource === "manual" || c.amountsSource === "adapter"
          ? c.amountsSource
          : "none",
      note: String(c.note || "").slice(0, 400),
    };
  }
  return {
    ...base,
    phase: raw.phase === "D4" ? "D4" : "D3",
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
 * เติมยอดในข้อเสนอจาก parse เมล (L3 เท่านั้น · ไม่ทับงบ L4)
 * Grab = ม้วนรายวัน · LM = รวมขายรายวัน + โอนรายวัน · Shopee = จากเมลที่ใช้ได้
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

    let days: DayAmt[] = [];
    if (ch === "lineman") {
      const salesRows = useful.filter((r) =>
        (r.studyTags || []).includes("lm-รายวัน-ขาย"),
      );
      const transferRows = useful.filter((r) =>
        (r.studyTags || []).includes("lm-รายวัน-โอน"),
      );
      const salesAmts = (salesRows.length ? salesRows : useful).map(
        parseReportAmounts,
      );
      const transferAmts = transferRows.map(parseReportAmounts);
      const salesRoll = rollupToAmounts(salesAmts);
      const transferRoll = rollupToAmounts(transferAmts);
      const appSales = salesRoll.appSales;
      const transfer =
        transferRoll.transfer != null && transferRoll.parsedOk
          ? transferRoll.transfer
          : salesRoll.transfer;
      let fee = 0;
      if (appSales != null && transfer != null && appSales >= transfer) {
        fee = roundMoney(appSales - transfer);
      } else if (salesRoll.gpExVat != null && salesRoll.gpVat != null) {
        fee = roundMoney((salesRoll.gpExVat || 0) + (salesRoll.gpVat || 0));
      }
      const gpVat = fee > 0 ? gpVatFromFee(fee, "incVat", 7) : 0;
      const gpExVat = fee > 0 ? roundMoney(fee - gpVat) : 0;
      const parsedOk = salesRoll.parsedOk + transferRoll.parsedOk;
      const parsedFail = salesRoll.parsedFail + transferRoll.parsedFail;
      const has = parsedOk > 0 && appSales != null;
      next.channels[ch] = {
        ...prev,
        amounts: has
          ? {
              appSales,
              transfer: transfer ?? 0,
              gpExVat: fee > 0 ? gpExVat : 0,
              gpVat: fee > 0 ? gpVat : 0,
            }
          : emptyAmounts(),
        amountsSource: has ? "adapter" : "none",
        status: has ? "ready" : prev.status,
        note: has
          ? `D4 จากเมล · parse ผ่าน ${parsedOk}` +
            (parsedFail ? ` · ไม่ผ่าน ${parsedFail}` : "") +
            " · ยังไม่ทับงบ"
          : `D4 ยังไม่มียอด · parse ไม่ผ่าน ${parsedFail || useful.length}`,
      };
      continue;
    }

    days = useful.map(parseReportAmounts);
    const roll = rollupToAmounts(days);
    const has = roll.parsedOk > 0 && roll.appSales != null;
    next.channels[ch] = {
      ...prev,
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
      note: has
        ? `D4 ม้วนจากเมล · ผ่าน ${roll.parsedOk}` +
          (roll.parsedFail ? ` · ไม่ผ่าน ${roll.parsedFail}` : "") +
          " · ยังไม่ทับงบ"
        : useful.length
          ? `D4 ยังไม่มียอด · parse ไม่ผ่าน ${roll.parsedFail} (มักอยู่แค่ PDF)`
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
