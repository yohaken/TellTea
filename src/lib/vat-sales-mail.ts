/**
 * Client helpers for VAT mail inbox (owner-only callables + Firestore reads).
 * Refresh tokens never leave Cloud Functions.
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
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDb, getFirebaseFunctions } from "./firebase";
import {
  DELIVERY_CHANNEL_LABELS,
  DEFAULT_MAIL_RULES,
  getDailySales,
  mapMailRules,
  upsertDailySales,
  type ChannelAmount,
  type DeliveryChannel,
  type MailChannelRule,
  type VatMailRules,
} from "./vat-sales";
import { parsePlatformEmail, type ParsedPlatformReport } from "./vat-sales-parse";
import { appendVatSalesAudit } from "./vat-sales-audit";

export type { MailChannelRule, VatMailRules };
export { DEFAULT_MAIL_RULES, mapMailRules };

export const PLATFORM_EMAIL_REPORTS_COL = "platformEmailReports";
export const VAT_MAIL_OAUTH_CONFIG_DOC = "vatMailOAuthConfig";

export type MailParseStatus =
  | "pending"
  | "ok"
  | "fail"
  | "confirmed"
  | "ignored";

export type PlatformEmailReport = {
  id: string;
  channel: DeliveryChannel | "unknown";
  provider: string;
  messageId: string;
  threadId: string;
  receivedAt: number;
  subject: string;
  from: string;
  snippet: string;
  rawText: string;
  rawHtml: string;
  reportDateGuess: string;
  reportKind: "daily" | "weekly" | "monthly";
  parseStatus: MailParseStatus;
  parseError: string;
  syncedAt: number;
  parserVersion: string;
  parsed: {
    reportDate: string;
    reportKind: "daily" | "weekly" | "monthly";
    periodStart: string | null;
    periodEnd: string | null;
    grossInclusive: number;
    fee: number;
    netTransfer: number;
    orderCount: number | null;
    confidence: string;
    warnings: string[];
  } | null;
};

export type VatMailStatus = {
  hasConfig: boolean;
  connected: boolean;
  provider: string | null;
  email: string;
  connectedAt: number;
  lastSyncAt: number;
  lastSyncError: string;
  lastSyncAdded: number;
};

export function channelReportLabel(channel: string): string {
  if (channel === "shopee" || channel === "grab" || channel === "lineman") {
    return DELIVERY_CHANNEL_LABELS[channel];
  }
  return "ไม่ทราบช่องทาง";
}

export function parseStatusLabel(status: MailParseStatus): string {
  switch (status) {
    case "pending":
      return "รอ parse";
    case "ok":
      return "รอตรวจ";
    case "fail":
      return "parse ไม่ผ่าน";
    case "confirmed":
      return "ยืนยันแล้ว";
    case "ignored":
      return "ข้าม";
    default:
      return status;
  }
}

function mapReport(id: string, data: Record<string, unknown>): PlatformEmailReport {
  const channelRaw = String(data.channel || "unknown");
  const channel: DeliveryChannel | "unknown" =
    channelRaw === "shopee" || channelRaw === "grab" || channelRaw === "lineman"
      ? channelRaw
      : "unknown";
  const parseRaw = String(data.parseStatus || "pending");
  const parseStatus: MailParseStatus =
    parseRaw === "ok" ||
    parseRaw === "fail" ||
    parseRaw === "confirmed" ||
    parseRaw === "ignored"
      ? parseRaw
      : "pending";
  const parsedRaw =
    data.parsed && typeof data.parsed === "object"
      ? (data.parsed as Record<string, unknown>)
      : null;
  const kindRaw = String(data.reportKind || parsedRaw?.reportKind || "daily");
  const reportKind: "daily" | "weekly" | "monthly" =
    kindRaw === "weekly" || kindRaw === "monthly" ? kindRaw : "daily";
  return {
    id,
    channel,
    provider: String(data.provider || "gmail"),
    messageId: String(data.messageId || ""),
    threadId: String(data.threadId || ""),
    receivedAt: Number(data.receivedAt) || Number(data.internalDate) || 0,
    subject: String(data.subject || ""),
    from: String(data.from || ""),
    snippet: String(data.snippet || ""),
    rawText: String(data.rawText || ""),
    rawHtml: String(data.rawHtml || ""),
    reportDateGuess: String(data.reportDateGuess || ""),
    reportKind,
    parseStatus,
    parseError: String(data.parseError || ""),
    syncedAt: Number(data.syncedAt) || 0,
    parserVersion: String(data.parserVersion || ""),
    parsed: parsedRaw
      ? {
          reportDate: String(parsedRaw.reportDate || ""),
          reportKind:
            parsedRaw.reportKind === "weekly" || parsedRaw.reportKind === "monthly"
              ? parsedRaw.reportKind
              : reportKind,
          periodStart:
            typeof parsedRaw.periodStart === "string" ? parsedRaw.periodStart : null,
          periodEnd: typeof parsedRaw.periodEnd === "string" ? parsedRaw.periodEnd : null,
          grossInclusive: Number(parsedRaw.grossInclusive) || 0,
          fee: Number(parsedRaw.fee) || 0,
          netTransfer: Number(parsedRaw.netTransfer) || 0,
          orderCount:
            typeof parsedRaw.orderCount === "number" ? parsedRaw.orderCount : null,
          confidence: String(parsedRaw.confidence || ""),
          warnings: Array.isArray(parsedRaw.warnings)
            ? parsedRaw.warnings.map(String)
            : [],
        }
      : null,
  };
}

export async function fetchVatMailStatus(): Promise<VatMailStatus> {
  const fn = httpsCallable<Record<string, never>, VatMailStatus>(
    getFirebaseFunctions(),
    "vatMailStatus",
  );
  const res = await fn({});
  return res.data;
}

export async function startVatMailOAuth(returnTo?: string): Promise<string> {
  const fn = httpsCallable<{ returnTo?: string }, { url: string }>(
    getFirebaseFunctions(),
    "vatMailOAuthStart",
  );
  const res = await fn(returnTo ? { returnTo } : {});
  const url = String(res.data?.url || "");
  if (!url) throw new Error("ไม่ได้รับลิงก์เชื่อม Gmail");
  return url;
}

export async function disconnectVatMail(): Promise<void> {
  const fn = httpsCallable(getFirebaseFunctions(), "vatMailDisconnect");
  await fn({});
}

export async function syncVatMail(lookbackDays = 31): Promise<{
  scanned: number;
  added: number;
  skipped: number;
  lookbackDays: number;
}> {
  const fn = httpsCallable<
    { lookbackDays?: number },
    { scanned: number; added: number; skipped: number; lookbackDays: number }
  >(getFirebaseFunctions(), "vatMailSync");
  const res = await fn({ lookbackDays });
  return res.data;
}

export async function listPlatformEmailReports(opts?: {
  channel?: DeliveryChannel | "unknown" | "all";
  parseStatus?: MailParseStatus | "all";
  max?: number;
}): Promise<PlatformEmailReport[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), PLATFORM_EMAIL_REPORTS_COL),
      orderBy("receivedAt", "desc"),
      limit(Math.min(300, Math.max(opts?.max || 80, 80))),
    ),
  );
  let rows = snap.docs.map((d) => mapReport(d.id, d.data() as Record<string, unknown>));
  if (opts?.channel && opts.channel !== "all") {
    rows = rows.filter((r) => r.channel === opts.channel);
  }
  if (opts?.parseStatus && opts.parseStatus !== "all") {
    rows = rows.filter((r) => r.parseStatus === opts.parseStatus);
  }
  return rows.slice(0, opts?.max || 80);
}

/** เมลที่เกี่ยวกับเดือน (reportDate / guess ขึ้นต้นด้วย YYYY-MM) */
export async function listPlatformEmailReportsForMonth(
  monthKey: string,
): Promise<PlatformEmailReport[]> {
  const rows = await listPlatformEmailReports({ max: 300 });
  return rows.filter((r) => {
    const d = (r.parsed?.reportDate || r.reportDateGuess || "").trim();
    return d.startsWith(monthKey);
  });
}

export async function setPlatformEmailIgnored(id: string, ignored: boolean): Promise<void> {
  await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, id), {
    parseStatus: ignored ? "ignored" : "pending",
    parseError: "",
  });
}

export type VatMailOAuthConfigPublic = {
  clientId: string;
  redirectUri: string;
  hasSecret: boolean;
  updatedAt: number;
};

/** Owner can save OAuth client config in Firestore when env is not set. */
export async function loadVatMailOAuthConfig(): Promise<VatMailOAuthConfigPublic | null> {
  const snap = await getDoc(doc(getDb(), "meta", VAT_MAIL_OAUTH_CONFIG_DOC));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  const clientId = String(data.clientId || "").trim();
  const redirectUri = String(data.redirectUri || "").trim();
  if (!clientId && !redirectUri) return null;
  return {
    clientId,
    redirectUri,
    hasSecret: Boolean(String(data.clientSecret || "").trim()),
    updatedAt: Number(data.updatedAt) || 0,
  };
}

export async function saveVatMailOAuthConfig(input: {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  updatedBy: string;
}): Promise<void> {
  const clientId = input.clientId.trim();
  const redirectUri = input.redirectUri.trim();
  if (!clientId || !redirectUri) {
    throw new Error("ต้องมี Client ID และ Redirect URI");
  }
  const payload: Record<string, unknown> = {
    clientId,
    redirectUri,
    updatedAt: Date.now(),
    updatedBy: input.updatedBy,
  };
  const secret = (input.clientSecret || "").trim();
  if (secret) payload.clientSecret = secret;
  await setDoc(doc(getDb(), "meta", VAT_MAIL_OAUTH_CONFIG_DOC), payload, { merge: true });
}

export async function reparsePlatformEmailReport(
  report: PlatformEmailReport,
): Promise<PlatformEmailReport> {
  if (report.channel === "unknown") {
    await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, report.id), {
      parseStatus: "fail",
      parseError: "ไม่ทราบช่องทาง",
      parserVersion: "unknown-v0",
      parsed: null,
    });
    return { ...report, parseStatus: "fail", parseError: "ไม่ทราบช่องทาง", parsed: null };
  }

  const result = parsePlatformEmail({
    channel: report.channel,
    subject: report.subject,
    rawText: report.rawText,
    rawHtml: report.rawHtml,
    reportDateGuess: report.reportDateGuess,
    receivedAt: report.receivedAt,
  });

  if (!result.ok) {
    await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, report.id), {
      parseStatus: "fail",
      parseError: result.error,
      parserVersion: result.parserVersion,
      parsed: null,
    });
    return {
      ...report,
      parseStatus: "fail",
      parseError: result.error,
      parserVersion: result.parserVersion,
      parsed: null,
    };
  }

  const parsed = result.parsed;
  await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, report.id), {
    parseStatus: "ok",
    parseError: "",
    parserVersion: parsed.parserVersion,
    reportDateGuess: parsed.reportDate,
    reportKind: parsed.reportKind,
    parsed: {
      reportDate: parsed.reportDate,
      reportKind: parsed.reportKind,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      grossInclusive: parsed.grossInclusive,
      fee: parsed.fee,
      netTransfer: parsed.netTransfer,
      orderCount: parsed.orderCount,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
      matchedLabels: parsed.matchedLabels,
      currency: parsed.currency,
    },
  });

  return {
    ...report,
    parseStatus: "ok",
    parseError: "",
    parserVersion: parsed.parserVersion,
    reportDateGuess: parsed.reportDate,
    reportKind: parsed.reportKind,
    parsed: {
      reportDate: parsed.reportDate,
      reportKind: parsed.reportKind,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      grossInclusive: parsed.grossInclusive,
      fee: parsed.fee,
      netTransfer: parsed.netTransfer,
      orderCount: parsed.orderCount,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
    },
  };
}

export async function reparsePendingPlatformEmails(max = 40): Promise<{
  ok: number;
  fail: number;
  skipped: number;
}> {
  const pending = await listPlatformEmailReports({ parseStatus: "pending", max: 200 });
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  for (const r of pending.slice(0, max)) {
    if (r.channel === "unknown") {
      skipped += 1;
      continue;
    }
    const next = await reparsePlatformEmailReport(r);
    if (next.parseStatus === "ok") ok += 1;
    else fail += 1;
  }
  return { ok, fail, skipped };
}

export type ConfirmEmailSalesInput = {
  reportId: string;
  channel: DeliveryChannel;
  reportDate: string;
  grossInclusive: number;
  fee?: number;
  netTransfer?: number;
  /** ทับยอดช่องทางเดิมถ้ามี */
  overwrite?: boolean;
  actor: string;
};

/**
 * ยืนยันยอดจากเมลเข้า dailySales ช่องทางนั้น (ไม่ auto ยืนยันทั้งวัน)
 * ถ้าวัน dailySales confirmed แล้ว → ต้องปลดล็อกวันก่อน
 */
export async function confirmEmailSalesToDaily(
  input: ConfirmEmailSalesInput,
): Promise<{ dateKey: string }> {
  const channel = input.channel;
  const dateKey = input.reportDate;
  // weekly/monthly ห้ามใส่ตารางรายวัน — ใช้แท็บเทียบยอด
  const reportSnap = await getDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, input.reportId));
  const parsedKind = reportSnap.exists()
    ? String((reportSnap.get("parsed") as { reportKind?: string } | undefined)?.reportKind || "")
    : "";
  const kind = String(
    parsedKind ||
      (reportSnap.exists() ? reportSnap.get("reportKind") || "daily" : "daily"),
  );
  if (kind === "weekly" || kind === "monthly") {
    throw new Error("เมลสรุปรายสัปดาห์/เดือน — ไปแท็บเทียบยอด ไม่ใส่ตารางรายวัน");
  }
  const existing = await getDailySales(dateKey);
  if (existing.status === "confirmed") {
    throw new Error("วันนี้ยืนยันแล้ว — ปลดล็อกวันในตารางรายวันก่อน");
  }

  const prev = existing.delivery[channel];
  const nextAmount: ChannelAmount = {
    grossInclusive: input.grossInclusive,
    fee: input.fee ?? 0,
    netTransfer: input.netTransfer ?? 0,
  };

  if (
    !input.overwrite &&
    prev.grossInclusive > 0 &&
    Math.abs(prev.grossInclusive - nextAmount.grossInclusive) > 0.009
  ) {
    throw new Error(
      `วัน ${dateKey} มียอด ${channel} อยู่แล้ว (${prev.grossInclusive}) — เลือกทับยอดถ้าต้องการ`,
    );
  }

  // กันยืนยันเมลซ้ำ
  if (existing.emailRefs[channel] && existing.emailRefs[channel] !== input.reportId) {
    if (!input.overwrite) {
      throw new Error("ช่องทางนี้ยืนยันจากเมลอื่นแล้ว — เลือกทับยอดถ้าต้องการ");
    }
  }

  await upsertDailySales(
    {
      dateKey,
      delivery: { [channel]: nextAmount },
      sources: { [channel]: "email", storefront: existing.sources.storefront },
      emailRefs: { [channel]: input.reportId },
    },
    input.actor,
  );

  await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, input.reportId), {
    parseStatus: "confirmed",
    parseError: "",
    confirmedAt: Date.now(),
    confirmedDateKey: dateKey,
  });

  await appendVatSalesAudit({
    action: "confirm_email",
    dateKey,
    summary: `ยืนยันเมล ${channel} → ${dateKey} · ${nextAmount.grossInclusive}`,
    before: {
      grossInclusive: prev.grossInclusive,
      emailRef: existing.emailRefs[channel] || "",
    },
    after: {
      grossInclusive: nextAmount.grossInclusive,
      fee: nextAmount.fee || 0,
      netTransfer: nextAmount.netTransfer || 0,
      reportId: input.reportId,
      channel,
    },
    actor: input.actor,
  });

  return { dateKey };
}

export type { ParsedPlatformReport };

