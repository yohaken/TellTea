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
  mapMailRules,
  type DeliveryChannel,
  type MailChannelRule,
  type VatMailRules,
} from "./vat-sales";

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
  parseStatus: MailParseStatus;
  parseError: string;
  syncedAt: number;
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
    parseStatus,
    parseError: String(data.parseError || ""),
    syncedAt: Number(data.syncedAt) || 0,
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
      limit(Math.min(200, Math.max(opts?.max || 80, 80))),
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
