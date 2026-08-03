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
  DELIVERY_CHANNELS,
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
import {
  isNoiseMail,
  isTaxInvoiceMail,
  matchMailChannel,
} from "./vat-mail-channel";
import { inferMailStudyTags, mergeStudyTags } from "./vat-mail-study";

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
  /** ชื่อไฟล์ PDF จาก Gmail */
  pdfFilenames: string[];
  /** พาธใน Firebase Storage (vat-mail-pdfs/…) */
  pdfStoragePaths: string[];
  pdfError: string;
  /** ไฟล์ที่อัปขึ้น Google Drive (TellTea-VAT/แอพ/เดือน) */
  driveFiles: VatMailDriveFile[];
  driveSyncedAt: number;
  syncedAt: number;
  parserVersion: string;
  /** แท็กศึกษาบนเว็บ — จูนร่วม AI · ยังไม่เข้างบ */
  studyTags: string[];
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

export type { MailStudyFileKind } from "./vat-mail-study";
export {
  inferMailStudyHints,
  MAIL_STUDY_TAG_PRESETS,
} from "./vat-mail-study";

export type VatMailDriveFile = {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  folderId: string;
  folderPath: string;
  channel: DeliveryChannel | string;
  monthKey: string;
  bytes: number;
  uploadedAt: number;
  sourceReportId: string;
  sourceMessageId: string;
};

export type VatMailDriveStatus = {
  hasDriveScope: boolean;
  rootFolderId: string;
  rootFolderName: string;
  rootWebViewLink: string;
  lastDriveSyncAt: number;
  lastDriveSyncUploaded: number;
  lastDriveSyncError: string;
  lastDriveSyncScanned: number;
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
  scope?: string;
  hasDriveScope?: boolean;
  drive?: VatMailDriveStatus;
};

function mapDriveFile(raw: unknown): VatMailDriveFile | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const fileId = String(d.fileId || "").trim();
  const name = String(d.name || "").trim();
  if (!fileId || !name) return null;
  return {
    fileId,
    name,
    mimeType: String(d.mimeType || ""),
    webViewLink: String(d.webViewLink || ""),
    folderId: String(d.folderId || ""),
    folderPath: String(d.folderPath || ""),
    channel: String(d.channel || ""),
    monthKey: String(d.monthKey || ""),
    bytes: Number(d.bytes) || 0,
    uploadedAt: Number(d.uploadedAt) || 0,
    sourceReportId: String(d.sourceReportId || ""),
    sourceMessageId: String(d.sourceMessageId || ""),
  };
}

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
    pdfFilenames: Array.isArray(data.pdfFilenames)
      ? data.pdfFilenames.map(String)
      : [],
    pdfStoragePaths: Array.isArray(data.pdfStoragePaths)
      ? data.pdfStoragePaths.map(String)
      : [],
    pdfError: String(data.pdfError || ""),
    driveFiles: Array.isArray(data.driveFiles)
      ? data.driveFiles
          .map(mapDriveFile)
          .filter((f): f is VatMailDriveFile => Boolean(f))
          .slice(0, 20)
      : [],
    driveSyncedAt: Number(data.driveSyncedAt) || 0,
    syncedAt: Number(data.syncedAt) || 0,
    parserVersion: String(data.parserVersion || ""),
    studyTags: Array.isArray(data.studyTags)
      ? data.studyTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
      : [],
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

/** Owner signed URL to open a stored mail PDF. */
export async function fetchVatMailPdfUrl(
  path: string,
  reportId?: string,
): Promise<string> {
  const fn = httpsCallable<
    { path: string; reportId?: string },
    { ok?: boolean; url?: string }
  >(getFirebaseFunctions(), "vatMailPdfUrl");
  const res = await fn(reportId ? { path, reportId } : { path });
  const url = String(res.data?.url || "");
  if (!url) throw new Error("ไม่ได้รับลิงก์เปิด PDF");
  return url;
}

export async function syncVatMail(lookbackDays = 120): Promise<{
  scanned: number;
  added: number;
  skipped: number;
  pdfEnriched?: number;
  reclassified?: number;
  noiseTagged?: number;
  lookbackDays: number;
}> {
  const fn = httpsCallable<
    { lookbackDays?: number },
    {
      scanned: number;
      added: number;
      skipped: number;
      pdfEnriched?: number;
      reclassified?: number;
      noiseTagged?: number;
      lookbackDays: number;
    }
  >(getFirebaseFunctions(), "vatMailSync");
  const res = await fn({ lookbackDays });
  return res.data;
}

/** คัดแยกเดือน/ชนิดรายงานจากเนื้อเมล — heuristic + Gemini เมื่อไม่ชัวร์ */
export async function classifyVatMailPeriods(opts?: {
  monthKey?: string;
  limit?: number;
  force?: boolean;
}): Promise<{
  scanned: number;
  updated: number;
  aiCalled: number;
  heuristicOnly: number;
  samples: Array<Record<string, unknown>>;
}> {
  const fn = httpsCallable<
    { monthKey?: string; limit?: number; force?: boolean },
    {
      scanned: number;
      updated: number;
      aiCalled: number;
      heuristicOnly: number;
      samples?: Array<Record<string, unknown>>;
    }
  >(getFirebaseFunctions(), "vatMailAiClassifyPeriod");
  const res = await fn({
    ...(opts?.monthKey ? { monthKey: opts.monthKey } : {}),
    ...(opts?.limit != null ? { limit: opts.limit } : {}),
    ...(opts?.force ? { force: true } : {}),
  });
  return {
    scanned: Number(res.data?.scanned) || 0,
    updated: Number(res.data?.updated) || 0,
    aiCalled: Number(res.data?.aiCalled) || 0,
    heuristicOnly: Number(res.data?.heuristicOnly) || 0,
    samples: Array.isArray(res.data?.samples) ? res.data.samples : [],
  };
}

/**
 * ซิงก์แนบเมล → Google Drive กองรวมต่อแอพ
 * TellTea-VAT/{grab|lineman|shopee}/ — ยังไม่แยกเดือนบน Drive
 */
export async function syncVatMailDrive(opts?: {
  monthKey?: string;
  /** true = กรองเมลตามเดือน (ไม่แนะนำช่วงนี้) */
  filterByMonth?: boolean;
}): Promise<{
  uploaded: number;
  skipped: number;
  scanned: number;
  rootCreated: boolean;
  rootFolderId: string;
  rootWebViewLink: string;
  monthKey: string;
  pileMode?: boolean;
  errors: string[];
  drive?: VatMailDriveStatus;
}> {
  const fn = httpsCallable<
    { monthKey?: string; filterByMonth?: boolean },
    {
      uploaded: number;
      skipped: number;
      scanned: number;
      rootCreated: boolean;
      rootFolderId: string;
      rootWebViewLink: string;
      monthKey: string;
      pileMode?: boolean;
      errors: string[];
      drive?: VatMailDriveStatus;
    }
  >(getFirebaseFunctions(), "vatMailDriveSync");
  const res = await fn({
    ...(opts?.monthKey ? { monthKey: opts.monthKey } : {}),
    ...(opts?.filterByMonth ? { filterByMonth: true } : {}),
  });
  return res.data;
}

/**
 * รวม driveFiles จากแคตตาล็อก — กองรวมต่อแอพ (ไม่กรองเดือนบน Drive)
 * monthKey ถ้าใส่ = ใช้ติ๊ก/เรียงเฉยๆ ไม่ซ่อนไฟล์เดือนอื่น
 */
export async function listMonthDriveFiles(monthKey?: string): Promise<{
  byChannel: Record<DeliveryChannel, VatMailDriveFile[]>;
  total: number;
}> {
  const empty = {
    byChannel: {
      grab: [] as VatMailDriveFile[],
      lineman: [] as VatMailDriveFile[],
      shopee: [] as VatMailDriveFile[],
    },
    total: 0,
  };

  const rows = await listPlatformEmailReports({ max: 400 });
  const byChannel = empty.byChannel;
  const seen = new Set<string>();
  const key = String(monthKey || "").trim();

  for (const row of rows) {
    for (const f of row.driveFiles) {
      const ch = f.channel || row.channel;
      if (ch !== "grab" && ch !== "lineman" && ch !== "shopee") continue;
      if (seen.has(f.fileId)) continue;
      seen.add(f.fileId);
      byChannel[ch].push(f);
    }
  }

  for (const ch of DELIVERY_CHANNELS) {
    byChannel[ch].sort((a, b) => {
      if (/^\d{4}-\d{2}$/.test(key)) {
        const am =
          a.monthKey === key || String(a.folderPath || "").includes(`/${key}/`)
            ? 1
            : 0;
        const bm =
          b.monthKey === key || String(b.folderPath || "").includes(`/${key}/`)
            ? 1
            : 0;
        if (am !== bm) return bm - am;
      }
      return (b.uploadedAt || 0) - (a.uploadedAt || 0);
    });
  }

  return {
    byChannel,
    total: seen.size,
  };
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
      limit(Math.min(500, Math.max(opts?.max || 120, 80))),
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

/** แท็กศึกษา — จูนร่วม AI · ไม่ผสานงบ */
export async function setPlatformEmailStudyTags(
  id: string,
  tags: string[],
): Promise<string[]> {
  const next = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(
    0,
    20,
  );
  await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, id), {
    studyTags: next,
    studyTagsUpdatedAt: Date.now(),
  });
  return next;
}

export async function togglePlatformEmailStudyTag(
  id: string,
  current: string[],
  tag: string,
): Promise<string[]> {
  const t = String(tag || "").trim();
  if (!t) return current;
  const has = current.includes(t);
  const next = has ? current.filter((x) => x !== t) : [...current, t];
  return setPlatformEmailStudyTags(id, next);
}

/** แก้ช่องทาง + แท็กศึกษา D2 (owner เขียน Firestore ตรง · ยังไม่เข้างบ) */
export async function reclassifyPlatformEmailReports(opts?: {
  max?: number;
  actor?: string;
  rules?: VatMailRules;
}): Promise<{
  scanned: number;
  reclassified: number;
  noiseTagged: number;
  tagged: number;
}> {
  const rows = await listPlatformEmailReports({ max: opts?.max || 300 });
  const rules = opts?.rules || DEFAULT_MAIL_RULES;
  let reclassified = 0;
  let noiseTagged = 0;
  let tagged = 0;
  for (const r of rows) {
    const next = matchMailChannel(r.from, r.subject, rules);
    const noise = isNoiseMail(r.from, r.subject) || isTaxInvoiceMail(r.subject);
    const inferredTags = inferMailStudyTags(
      {
        from: r.from,
        subject: r.subject,
        snippet: r.snippet,
        channel: next !== "unknown" ? next : r.channel,
        reportKind: r.reportKind,
        pdfFilenames: r.pdfFilenames,
        studyTags: r.studyTags,
      },
      rules,
    );
    const { next: studyTags, changed: tagsChanged } = mergeStudyTags(
      r.studyTags,
      inferredTags,
    );
    const patch: Record<string, unknown> = {};
    if (next !== "unknown" && next !== r.channel) {
      patch.channel = next;
    }
    if (tagsChanged) {
      patch.studyTags = studyTags;
      patch.studyTagsUpdatedAt = Date.now();
    }
    if (!Object.keys(patch).length) continue;
    patch.channelReclassifiedAt = Date.now();
    patch.channelReclassifiedBy = opts?.actor || "owner";
    await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, r.id), patch);
    reclassified += 1;
    if (patch.studyTags) tagged += 1;
    if (noise && studyTags.includes("ข้าม")) noiseTagged += 1;
  }
  return { scanned: rows.length, reclassified, noiseTagged, tagged };
}

/** เวอร์ชันจูนศึกษา D2 — เปิดหน้าที่มาแล้วรันอัตโนมัติครั้งหนึ่ง */
export const VAT_MAIL_STUDY_PASS = 2;
export const VAT_MAIL_STUDY_PASS_DOC = "vatMailStudyPass";

export async function loadVatMailStudyPass(): Promise<number> {
  const snap = await getDoc(doc(getDb(), "meta", VAT_MAIL_STUDY_PASS_DOC));
  if (!snap.exists()) return 0;
  return Number(snap.data()?.pass) || 0;
}

export async function saveVatMailStudyPass(
  pass: number,
  actor: string,
): Promise<void> {
  await setDoc(
    doc(getDb(), "meta", VAT_MAIL_STUDY_PASS_DOC),
    {
      pass,
      updatedAt: Date.now(),
      updatedBy: actor || "owner",
    },
    { merge: true },
  );
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
  return reparseMailQueue({ max, statuses: ["pending"] });
}

/**
 * Parse คิวเมลอัตโนมัติ — รวม pending + fail (กันค้างหลังดึง PDF แล้ว)
 */
export async function reparseMailQueue(opts?: {
  max?: number;
  statuses?: Array<"pending" | "fail" | "ok">;
}): Promise<{
  ok: number;
  fail: number;
  skipped: number;
}> {
  const max = Math.min(120, Math.max(opts?.max || 80, 1));
  const statuses = opts?.statuses?.length
    ? opts.statuses
    : (["pending", "fail"] as Array<"pending" | "fail">);
  const seen = new Set<string>();
  const queue: PlatformEmailReport[] = [];
  for (const st of statuses) {
    const rows = await listPlatformEmailReports({ parseStatus: st, max: 200 });
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      queue.push(r);
    }
  }
  // ใหม่ก่อน · Grab/PDF ก่อน
  queue.sort((a, b) => {
    const ap = a.rawText.includes("--- PDF ---") || a.channel === "grab" ? 1 : 0;
    const bp = b.rawText.includes("--- PDF ---") || b.channel === "grab" ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.receivedAt - a.receivedAt;
  });

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  for (const r of queue.slice(0, max)) {
    if (r.channel === "unknown") {
      skipped += 1;
      continue;
    }
    if (r.parseStatus === "confirmed" || r.parseStatus === "ignored") {
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

export type AutoApplySkipReason =
  | "not_daily"
  | "no_parsed"
  | "day_confirmed"
  | "manual_exists"
  | "email_exists"
  | "already"
  | "date_conflict"
  | "error";

export type AutoApplyChannelResult = {
  channel: DeliveryChannel;
  candidates: number;
  applied: number;
  skipped: number;
  reasons: Partial<Record<AutoApplySkipReason, number>>;
  appliedDates: string[];
};

function bumpReason(
  reasons: Partial<Record<AutoApplySkipReason, number>>,
  reason: AutoApplySkipReason,
) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

/**
 * ลงยอดจากเมล parse แล้วเข้าตารางรายวัน (วันยังเป็น draft)
 * ทีละแพลตฟอร์ม · ข้ามสัปดาห์/เดือน · ไม่ทับวันยืนยัน / ยอดมือ / เมลอื่น
 */
export async function autoApplyMailToDaily(opts: {
  channel: DeliveryChannel;
  actor: string;
  max?: number;
}): Promise<AutoApplyChannelResult> {
  const channel = opts.channel;
  const max = Math.min(120, Math.max(opts.max || 80, 1));
  const reasons: Partial<Record<AutoApplySkipReason, number>> = {};
  const appliedDates: string[] = [];
  let applied = 0;
  let skipped = 0;

  const rows = await listPlatformEmailReports({
    channel,
    parseStatus: "ok",
    max: 200,
  });
  const candidates = rows.filter((r) => {
    if (r.channel !== channel) return false;
    if (!r.parsed) {
      bumpReason(reasons, "no_parsed");
      skipped += 1;
      return false;
    }
    const kind = r.parsed.reportKind || r.reportKind;
    if (kind !== "daily") {
      bumpReason(reasons, "not_daily");
      skipped += 1;
      return false;
    }
    return true;
  });

  // จัดกลุ่มตามวัน — ถ้าวันเดียวหลายฉบับยอดไม่ตรง = ข้ามทั้งวัน
  const byDate = new Map<string, PlatformEmailReport[]>();
  for (const r of candidates) {
    const dateKey = (r.parsed?.reportDate || r.reportDateGuess || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      bumpReason(reasons, "no_parsed");
      skipped += 1;
      continue;
    }
    const list = byDate.get(dateKey) || [];
    list.push(r);
    byDate.set(dateKey, list);
  }

  const sortedDates = [...byDate.keys()].sort();
  for (const dateKey of sortedDates) {
    if (applied >= max) break;
    const group = byDate.get(dateKey) || [];
    if (group.length === 0) continue;

    const amounts = group.map((r) => r.parsed!.grossInclusive);
    const base = amounts[0];
    const conflict = amounts.some((g) => Math.abs(g - base) > 0.009);
    if (conflict) {
      bumpReason(reasons, "date_conflict");
      skipped += group.length;
      continue;
    }

    // เลือกฉบับล่าสุด
    const report = [...group].sort((a, b) => b.receivedAt - a.receivedAt)[0];
    const parsed = report.parsed!;
    try {
      const day = await getDailySales(dateKey);
      if (day.status === "confirmed") {
        bumpReason(reasons, "day_confirmed");
        skipped += 1;
        continue;
      }

      const prev = day.delivery[channel];
      const src = day.sources[channel];
      const ref = day.emailRefs[channel] || "";

      if (ref === report.id) {
        bumpReason(reasons, "already");
        skipped += 1;
        // เมลยังเป็น ok — ทำเครื่องหมาย confirmed ให้ตรงตาราง
        if (report.parseStatus === "ok") {
          await updateDoc(doc(getDb(), PLATFORM_EMAIL_REPORTS_COL, report.id), {
            parseStatus: "confirmed",
            parseError: "",
            confirmedAt: Date.now(),
            confirmedDateKey: dateKey,
          });
        }
        continue;
      }

      if (ref && ref !== report.id) {
        bumpReason(reasons, "email_exists");
        skipped += 1;
        continue;
      }

      const hasAmount =
        prev.grossInclusive > 0.009 ||
        (prev.fee || 0) > 0.009 ||
        (prev.netTransfer || 0) > 0.009;

      // มียอดอยู่แล้วแต่ไม่ได้มาจากเมล → ข้าม (กันทับมือ / POS)
      if (hasAmount && src !== "email") {
        bumpReason(reasons, "manual_exists");
        skipped += 1;
        continue;
      }

      if (
        hasAmount &&
        src === "email" &&
        Math.abs(prev.grossInclusive - parsed.grossInclusive) > 0.009
      ) {
        bumpReason(reasons, "email_exists");
        skipped += 1;
        continue;
      }

      // ยอดเท่ากันอยู่แล้ว (มือ/ว่าง) — ลง ref ได้
      await confirmEmailSalesToDaily({
        reportId: report.id,
        channel,
        reportDate: dateKey,
        grossInclusive: parsed.grossInclusive,
        fee: parsed.fee,
        netTransfer: parsed.netTransfer,
        overwrite: !hasAmount || Math.abs(prev.grossInclusive - parsed.grossInclusive) <= 0.009,
        actor: opts.actor,
      });
      applied += 1;
      appliedDates.push(dateKey);
    } catch {
      bumpReason(reasons, "error");
      skipped += 1;
    }
  }

  return {
    channel,
    candidates: candidates.length,
    applied,
    skipped,
    reasons,
    appliedDates,
  };
}

export type PullAndFillMailResult = {
  sync: {
    ok: boolean;
    added?: number;
    scanned?: number;
    pdfEnriched?: number;
    error?: string;
  } | null;
  parse: { ok: number; fail: number; skipped: number };
  apply: AutoApplyChannelResult[];
};

/**
 * ดึงเมล Gmail หลัก → parse → ลงตารางทีละแพลตฟอร์ม (Shopee → Grab → LINE MAN)
 * วันในตารางยังเป็น draft · เจ้าของยืนยันวันทีหลัง
 */
export async function pullAndFillDailyFromMail(opts: {
  actor: string;
  lookbackDays?: number;
  sync?: boolean;
}): Promise<PullAndFillMailResult> {
  const lookbackDays = opts.lookbackDays ?? 31;
  let sync: PullAndFillMailResult["sync"] = null;

  if (opts.sync !== false) {
    try {
      const res = await syncVatMail(lookbackDays);
      sync = {
        ok: true,
        added: res.added,
        scanned: res.scanned,
        pdfEnriched: res.pdfEnriched || 0,
      };
    } catch (e) {
      sync = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // parse ทั้ง pending + fail — กันเมล Grab ที่เคย fail ก่อนมีดึง PDF
  const parse = await reparseMailQueue({ max: 100, statuses: ["pending", "fail"] });
  const apply: AutoApplyChannelResult[] = [];
  for (const channel of DELIVERY_CHANNELS) {
    apply.push(
      await autoApplyMailToDaily({
        channel,
        actor: opts.actor,
        max: 100,
      }),
    );
  }

  return { sync, parse, apply };
}

export type { ParsedPlatformReport };

