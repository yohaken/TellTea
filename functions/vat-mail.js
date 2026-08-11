/**
 * VAT mail — Gmail OAuth + sync platform daily reports (owner-only).
 * Tokens: meta/vatMailOAuth · OAuth client: env or meta/vatMailOAuthConfig
 *   GMAIL_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI
 */
const functions = require("firebase-functions/v1");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const {
  extractPdfTextFromMessage,
  mergeBodyWithPdf,
  needsPdfEnrich,
  signedPdfReadUrl,
} = require("./vat-mail-pdf");
const {
  isNoiseMail,
  isTaxInvoiceMail,
  matchChannel,
  sanitizeChannelRule,
} = require("./vat-mail-channel");
const { inferMailStudyTags, tagsChanged } = require("./vat-mail-study-tags");
const {
  resolveReportPeriod,
  periodFieldsFromResolved,
} = require("./vat-mail-period");
const {
  publicDriveStatus,
  DRIVE_META_DOC,
} = require("./vat-mail-drive");

const REGION = "asia-southeast1";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

const OAUTH_DOC = "meta/vatMailOAuth";
const OAUTH_CONFIG_DOC = "meta/vatMailOAuthConfig";
const OAUTH_STATE_DOC = "meta/vatMailOAuthState";
const SETTINGS_DOC = "meta/vatSalesSettings";
const REPORTS_COL = "platformEmailReports";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Gmail อ่านเมล + Drive สร้าง/เขียนเฉพาะไฟล์ที่แอพสร้าง */
const OAUTH_SCOPES = `${GMAIL_SCOPE} ${DRIVE_SCOPE}`;
/** ปิดงบต้นเดือนต้องย้อนหลายหน้า Gmail + คาบเกี่ยวเดือนก่อน/หลัง */
const DEFAULT_LOOKBACK_DAYS = 120;
const MAX_LOOKBACK_DAYS = 180;
const MAX_MESSAGES_PER_SYNC = 300;

function reportDocId(messageId) {
  const safe = String(messageId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `gmail_${safe || crypto.randomBytes(8).toString("hex")}`;
}

const DEFAULT_MAIL_RULES = {
  shopee: {
    enabled: true,
    fromIncludes: [
      "shopeefood.com",
      "shopeefood",
      "shopee.co.th",
      "shopee.com",
      "shopee",
    ],
    // ห้ามคำกว้างอย่าง สรุปยอด / ยอดขาย — จะไปจับ Grab/LM
    subjectIncludes: [
      "shopeefood",
      "shopee food",
      "รายงานการโอนเงิน",
      "ใบแจ้งยอด",
      "settlement",
      "ค่าคอมมิชชั่น",
      "commission",
    ],
    subjectExcludes: [
      "otp",
      "verify",
      "chargeback",
      "รีเซ็ต",
      "ยืนยันอีเมล",
    ],
  },
  grab: {
    enabled: true,
    fromIncludes: ["grab.com", "grabfood"],
    subjectIncludes: [
      "สรุปยอดขายสำหรับคำสั่งซื้อ",
      "grabfood",
      "daily sales",
    ],
    subjectExcludes: [
      "tax invoice",
      "ใบกำกับภาษี",
      "receipt/tax",
      "receipt / tax",
      "ใบเสร็จ",
      "ความเสี่ยง",
      "account risk",
    ],
  },
  lineman: {
    enabled: true,
    fromIncludes: ["lmwn.com", "lmwn", "lineman", "wongnai", "line.me"],
    subjectIncludes: [
      "รายงานยอดขายรายวัน",
      "รายงานยอดโอนออก",
      "line man",
      "lineman",
    ],
    subjectExcludes: [
      "otp",
      "verify",
      "รีเซ็ต",
      "ยืนยันอีเมล",
      "password",
      "reset",
    ],
  },
};

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function actorFromAuth(auth) {
  const email = asString(auth?.token?.email, 120).toLowerCase();
  if (email) return email;
  const phone = asString(auth?.token?.phone_number, 32);
  return phone || asString(auth?.uid, 64);
}

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = asString(context.auth.token?.email, 120).toLowerCase();
  if (email && email === OWNER_EMAIL) {
    return { actorId: email };
  }
  const db = getFirestore();
  let staffId = email;
  if (!staffId) {
    const phone = asString(context.auth.token?.phone_number, 32);
    const digits = phone.startsWith("+") ? phone.slice(1) : phone;
    if (!digits) {
      throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
    }
    const phoneSnap = await db.collection("staffPhones").doc(digits).get();
    staffId = asString(phoneSnap.exists ? phoneSnap.get("staffId") : "", 120);
  }
  if (!staffId) {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  const staffSnap = await db.collection("staff").doc(staffId).get();
  if (!staffSnap.exists || staffSnap.get("role") !== "owner") {
    throw new functions.https.HttpsError("permission-denied", "บัญชีนี้ไม่ใช่เจ้าของร้าน");
  }
  return { actorId: staffId };
}

async function loadOAuthConfig(db) {
  const envId = String(process.env.GMAIL_OAUTH_CLIENT_ID || "").trim();
  const envSecret = String(process.env.GMAIL_OAUTH_CLIENT_SECRET || "").trim();
  const envRedirect = String(process.env.GMAIL_OAUTH_REDIRECT_URI || "").trim();
  if (envId && envSecret && envRedirect) {
    return { clientId: envId, clientSecret: envSecret, redirectUri: envRedirect, source: "env" };
  }
  const snap = await db.doc(OAUTH_CONFIG_DOC).get();
  const data = snap.exists ? snap.data() : {};
  const clientId = asString(data.clientId, 200);
  const clientSecret = asString(data.clientSecret, 200);
  const redirectUri = asString(data.redirectUri, 400);
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri, source: "firestore" };
}

function publicOAuthStatus(oauthData, hasConfig, driveMeta) {
  const connected = Boolean(oauthData && oauthData.refreshToken);
  const drive = publicDriveStatus(oauthData, driveMeta || {});
  return {
    hasConfig: Boolean(hasConfig),
    connected,
    provider: connected ? "gmail" : null,
    email: connected ? asString(oauthData.email, 120) : "",
    connectedAt: connected ? Number(oauthData.connectedAt) || 0 : 0,
    lastSyncAt: connected ? Number(oauthData.lastSyncAt) || 0 : 0,
    lastSyncError: connected ? asString(oauthData.lastSyncError, 300) : "",
    lastSyncAdded: connected ? Number(oauthData.lastSyncAdded) || 0 : 0,
    scope: connected ? asString(oauthData.scope, 400) : "",
    hasDriveScope: drive.hasDriveScope,
    drive,
  };
}

function appReturnUrl(base, query) {
  const root = asString(base, 400) || "https://telltea-bo.web.app/vat-sales/";
  const url = new URL(root.includes("?") ? root : root.endsWith("/") ? root : `${root}/`);
  if (!url.pathname.includes("vat-sales")) {
    url.pathname = "/vat-sales/";
  }
  Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url.toString();
}

async function exchangeCode(config, code) {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token && !json.access_token) {
    const msg = json.error_description || json.error || `token exchange failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function refreshAccessToken(config, refreshToken) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const msg = json.error_description || json.error || `refresh failed (${res.status})`;
    throw new Error(msg);
  }
  return json.access_token;
}

async function gmailGetProfile(accessToken) {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `profile failed (${res.status})`);
  return asString(json.emailAddress, 120).toLowerCase();
}

function bangkokDateKey(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "0";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function decodeBase64Url(data) {
  const s = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64").toString("utf8");
}

function collectParts(payload, out = { text: "", html: "" }) {
  if (!payload || typeof payload !== "object") return out;
  const mime = String(payload.mimeType || "").toLowerCase();
  const bodyData = payload.body && payload.body.data ? payload.body.data : "";
  if (bodyData) {
    const decoded = decodeBase64Url(bodyData);
    if (mime.includes("text/plain")) out.text += decoded;
    else if (mime.includes("text/html")) out.html += decoded;
    else if (!out.text && mime.startsWith("text/")) out.text += decoded;
  }
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) collectParts(p, out);
  return out;
}

function headerMap(headers) {
  const map = {};
  for (const h of headers || []) {
    const name = asString(h.name, 80).toLowerCase();
    if (!name) continue;
    map[name] = asString(h.value, 1000);
  }
  return map;
}

function normalizeRule(raw, fallback, channel) {
  return sanitizeChannelRule(channel, raw, fallback);
}

function loadMailRules(settings) {
  const raw = settings && settings.mailRules && typeof settings.mailRules === "object"
    ? settings.mailRules
    : {};
  return {
    shopee: normalizeRule(raw.shopee, DEFAULT_MAIL_RULES.shopee, "shopee"),
    grab: normalizeRule(raw.grab, DEFAULT_MAIL_RULES.grab, "grab"),
    lineman: normalizeRule(raw.lineman, DEFAULT_MAIL_RULES.lineman, "lineman"),
  };
}

function fromHitsSearchChannel(from, rule) {
  const f = String(from || "").toLowerCase();
  return (rule?.fromIncludes || []).some((k) => k && f.includes(String(k).toLowerCase()));
}

async function reclassifyStoredReports(db, rules, actorId) {
  const snap = await db.collection(REPORTS_COL).limit(500).get();
  let reclassified = 0;
  let noiseTagged = 0;
  let tagged = 0;
  let periodFixed = 0;
  for (const docSnap of snap.docs) {
    const d = docSnap.data() || {};
    const from = String(d.from || "");
    const subject = String(d.subject || "");
    const next = matchChannel(from, subject, rules);
    const noise = isNoiseMail(from, subject) || isTaxInvoiceMail(subject);
    const period = periodFieldsFromResolved(
      resolveReportPeriod({
        subject,
        snippet: d.snippet,
        rawText: d.rawText,
        receivedAt: d.receivedAt || d.internalDate,
      }),
    );
    const nextTags = inferMailStudyTags(
      {
        from,
        subject,
        channel: next !== "unknown" ? next : d.channel,
        pdfFilenames: d.pdfFilenames,
        studyTags: d.studyTags,
        reportKind: period.reportKind,
        snippet: d.snippet,
        rawText: d.rawText,
      },
      rules,
    );
    const patch = {};
    if (next !== "unknown" && next !== d.channel) {
      patch.channel = next;
    }
    if (
      d.reportDateGuess !== period.reportDateGuess ||
      d.reportKind !== period.reportKind ||
      d.periodMonthKey !== period.periodMonthKey ||
      d.periodStart !== period.periodStart ||
      d.periodEnd !== period.periodEnd
    ) {
      Object.assign(patch, period);
      periodFixed += 1;
    }
    if (tagsChanged(d.studyTags, nextTags)) {
      patch.studyTags = nextTags;
      patch.studyTagsUpdatedAt = Date.now();
    }
    if (!Object.keys(patch).length) continue;
    patch.channelReclassifiedAt = Date.now();
    patch.channelReclassifiedBy = actorId || "sync";
    await docSnap.ref.set(patch, { merge: true });
    reclassified += 1;
    if (patch.studyTags) tagged += 1;
    if (noise && nextTags.includes("ข้าม")) noiseTagged += 1;
  }
  return { reclassified, noiseTagged, tagged, periodFixed, scanned: snap.size };
}

function unionUnique(a, b, max = 12) {
  const out = [];
  const seen = new Set();
  for (const raw of [...(a || []), ...(b || [])]) {
    const t = String(raw || "").trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** รวมกฎที่เซฟไว้กับ default — กัน settings เก่าทำให้ Shopee/ช่วงย้อนหาย */
function expandRuleForSearch(channel, rule) {
  const fb = DEFAULT_MAIL_RULES[channel] || rule;
  return {
    ...rule,
    fromIncludes: unionUnique(rule?.fromIncludes, fb.fromIncludes, 8),
    subjectIncludes: unionUnique(rule?.subjectIncludes, fb.subjectIncludes, 10),
    subjectExcludes: unionUnique(rule?.subjectExcludes, fb.subjectExcludes, 10),
  };
}

function buildSearchQuery(rule, lookbackDays, channel) {
  const after = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const y = after.getUTCFullYear();
  const m = String(after.getUTCMonth() + 1).padStart(2, "0");
  const d = String(after.getUTCDate()).padStart(2, "0");
  const parts = [`after:${y}/${m}/${d}`];
  // ค้นจาก From เป็นหลัก (กัน subject กว้างดึงข้ามช่อง)
  const fromTerms = (rule.fromIncludes || []).slice(0, 6).map((t) => `from:${t}`);
  if (fromTerms.length) {
    parts.push(`(${fromTerms.join(" OR ")})`);
  } else {
    const subTerms = (rule.subjectIncludes || []).slice(0, 5).map((t) => {
      const q = String(t).includes(" ") ? `"${t}"` : t;
      return `subject:${q}`;
    });
    if (subTerms.length) parts.push(`(${subTerms.join(" OR ")})`);
  }
  // Shopee มักเป็นไฟล์แนบ Excel/CSV — บังคับมีแนบหรือชื่อไฟล์
  if (channel === "shopee") {
    parts.push(
      "(has:attachment OR filename:xlsx OR filename:xls OR filename:csv OR filename:pdf)",
    );
  }
  for (const ex of (rule.subjectExcludes || []).slice(0, 8)) {
    const q = String(ex).includes(" ") ? `"${ex}"` : ex;
    parts.push(`-subject:${q}`);
  }
  return parts.join(" ");
}

async function listMessageIds(accessToken, q, maxResults) {
  const ids = [];
  let pageToken = "";
  while (ids.length < maxResults) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(Math.min(50, maxResults - ids.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error?.message || `list failed (${res.status})`);
    for (const m of json.messages || []) {
      if (m.id) ids.push(m.id);
    }
    pageToken = json.nextPageToken || "";
    if (!pageToken || !(json.messages || []).length) break;
  }
  return ids;
}

async function getMessage(accessToken, id) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `get message failed (${res.status})`);
  return json;
}

function guessReportKind(subject) {
  const hay = String(subject || "").toLowerCase();
  if (/รายเดือน|monthly|month[- ]?end|สรุปรอบเดือน|ประจำเดือน/.test(hay)) return "monthly";
  if (/รายสัปดาห์|weekly|สัปดาห์|ประจำสัปดาห์|week[- ]?of|week\s*ending/.test(hay)) {
    return "weekly";
  }
  return "daily";
}

function toCeYear(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 2400) return n - 543;
  if (n >= 1900) return n;
  if (n >= 0 && n < 100) return 2500 + n - 543;
  return null;
}

const THAI_MONTHS = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
  "ม.ค": 1,
  "ก.พ": 2,
  "มี.ค": 3,
  "เม.ย": 4,
  "พ.ค": 5,
  "มิ.ย": 6,
  "ก.ค": 7,
  "ส.ค": 8,
  "ก.ย": 9,
  "ต.ค": 10,
  "พ.ย": 11,
  "ธ.ค": 12,
};

function guessReportDate(subject, internalDateMs) {
  const s = String(subject || "");
  const pad = (n) => String(n).padStart(2, "0");
  const ok = (y, mo, d) => y >= 2018 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

  const thKeys = Object.keys(THAI_MONTHS).sort((a, b) => b.length - a.length);
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const thRe = new RegExp(
    `(\\d{1,2})\\s*(${thKeys.map(esc).join("|")})\\.?\\s*(25\\d{2}|20\\d{2}|\\d{2})`,
    "i",
  );
  const th = s.match(thRe);
  if (th) {
    const day = Number(th[1]);
    const month = THAI_MONTHS[th[2].replace(/\.$/, "")] || THAI_MONTHS[th[2]];
    const year = toCeYear(th[3]);
    if (month && year && ok(year, month, day)) return `${year}-${pad(month)}-${pad(day)}`;
  }

  const iso = s.match(/(?<!\d)(20\d{2}|25\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (iso) {
    const year = toCeYear(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (year && ok(year, mo, d)) return `${year}-${pad(mo)}-${pad(d)}`;
  }

  const dmy4 = s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](20\d{2}|25\d{2})(?!\d)/);
  if (dmy4) {
    const year = toCeYear(dmy4[3]);
    const mo = Number(dmy4[2]);
    const d = Number(dmy4[1]);
    if (year && ok(year, mo, d)) return `${year}-${pad(mo)}-${pad(d)}`;
  }

  const dmy2 = s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2})(?!\d)/);
  if (dmy2) {
    const year = toCeYear(dmy2[3]);
    const mo = Number(dmy2[2]);
    const d = Number(dmy2[1]);
    if (year && ok(year, mo, d)) return `${year}-${pad(mo)}-${pad(d)}`;
  }

  return bangkokDateKey(internalDateMs || Date.now());
}


exports.vatMailStatus = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const db = getFirestore();
    const [oauthSnap, config, driveSnap] = await Promise.all([
      db.doc(OAUTH_DOC).get(),
      loadOAuthConfig(db),
      db.doc(DRIVE_META_DOC).get(),
    ]);
    return {
      ...publicOAuthStatus(
        oauthSnap.exists ? oauthSnap.data() : null,
        Boolean(config),
        driveSnap.exists ? driveSnap.data() : null,
      ),
      actorId,
    };
  });

exports.vatMailOAuthStart = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const db = getFirestore();
    const config = await loadOAuthConfig(db);
    if (!config) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่ได้ตั้งค่า Gmail OAuth (GMAIL_OAUTH_* หรือ meta/vatMailOAuthConfig)",
      );
    }
    const returnTo = asString(data?.returnTo, 400) || "https://telltea-bo.web.app/vat-sales/";
    const state = crypto.randomBytes(24).toString("hex");
    await db.doc(OAUTH_STATE_DOC).set({
      state,
      actorId,
      returnTo,
      createdAt: Date.now(),
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPES);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("state", state);
    return { url: url.toString() };
  });

exports.vatMailOAuthCallback = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const db = getFirestore();
    let returnTo = "https://telltea-bo.web.app/vat-sales/";
    try {
      const code = asString(req.query.code, 500);
      const state = asString(req.query.state, 120);
      const err = asString(req.query.error, 120);
      const stateSnap = await db.doc(OAUTH_STATE_DOC).get();
      const stateData = stateSnap.exists ? stateSnap.data() : null;
      if (stateData?.returnTo) returnTo = asString(stateData.returnTo, 400) || returnTo;

      if (err) {
        res.redirect(appReturnUrl(returnTo, { mail: "error", reason: err }));
        return;
      }
      if (!code || !state || !stateData || stateData.state !== state) {
        res.redirect(appReturnUrl(returnTo, { mail: "error", reason: "invalid_state" }));
        return;
      }
      if (Date.now() - Number(stateData.createdAt || 0) > 15 * 60 * 1000) {
        res.redirect(appReturnUrl(returnTo, { mail: "error", reason: "state_expired" }));
        return;
      }

      const config = await loadOAuthConfig(db);
      if (!config) {
        res.redirect(appReturnUrl(returnTo, { mail: "error", reason: "no_config" }));
        return;
      }

      const tokenJson = await exchangeCode(config, code);
      const accessToken = tokenJson.access_token;
      const refreshToken = tokenJson.refresh_token;
      if (!refreshToken) {
        const prev = await db.doc(OAUTH_DOC).get();
        const oldRefresh = prev.exists ? asString(prev.get("refreshToken"), 500) : "";
        if (!oldRefresh) {
          res.redirect(appReturnUrl(returnTo, { mail: "error", reason: "no_refresh_token" }));
          return;
        }
        const email = await gmailGetProfile(accessToken);
        await db.doc(OAUTH_DOC).set(
          {
            provider: "gmail",
            email,
            scope: asString(tokenJson.scope, 400) || OAUTH_SCOPES,
            connectedAt: Date.now(),
            connectedBy: asString(stateData.actorId, 120),
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      } else {
        const email = await gmailGetProfile(accessToken);
        await db.doc(OAUTH_DOC).set(
          {
            provider: "gmail",
            email,
            refreshToken,
            scope: asString(tokenJson.scope, 400) || OAUTH_SCOPES,
            connectedAt: Date.now(),
            connectedBy: asString(stateData.actorId, 120),
            lastSyncAt: FieldValue.delete(),
            lastSyncError: "",
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      }

      await db.doc(OAUTH_STATE_DOC).delete().catch(() => undefined);
      res.redirect(appReturnUrl(returnTo, { mail: "connected", tab: "mail" }));
    } catch (e) {
      console.error("vatMailOAuthCallback", e);
      res.redirect(
        appReturnUrl(returnTo, {
          mail: "error",
          reason: asString(e?.message || "callback_failed", 80),
        }),
      );
    }
  });

exports.vatMailDisconnect = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await assertOwner(context);
    const db = getFirestore();
    await db.doc(OAUTH_DOC).delete().catch(() => undefined);
    return { ok: true };
  });

exports.vatMailSync = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 300, memory: "1GB" })
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const db = getFirestore();
    const config = await loadOAuthConfig(db);
    if (!config) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่ได้ตั้งค่า Gmail OAuth",
      );
    }
    const oauthSnap = await db.doc(OAUTH_DOC).get();
    if (!oauthSnap.exists || !oauthSnap.get("refreshToken")) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "ยังไม่ได้เชื่อม Gmail",
      );
    }
    const refreshToken = asString(oauthSnap.get("refreshToken"), 500);
    const lookbackDays = Math.min(
      MAX_LOOKBACK_DAYS,
      Math.max(1, Number(data?.lookbackDays) || DEFAULT_LOOKBACK_DAYS),
    );

    try {
      const accessToken = await refreshAccessToken(config, refreshToken);
      const settingsSnap = await db.doc(SETTINGS_DOC).get();
      const settings = settingsSnap.exists ? settingsSnap.data() : {};
      const rules = loadMailRules(settings);
      const channelsEnabled = settings.channelsEnabled || {};

      const channels = ["shopee", "grab", "lineman"];

      const seen = new Set();
      let scanned = 0;
      let added = 0;
      let skipped = 0;
      let pdfEnriched = 0;

      for (const channel of channels) {
        if (channelsEnabled[channel] === false) continue;
        const rule = expandRuleForSearch(channel, rules[channel]);
        if (!rule.enabled) continue;
        const q = buildSearchQuery(rule, lookbackDays, channel);
        const ids = await listMessageIds(accessToken, q, MAX_MESSAGES_PER_SYNC);
        for (const messageId of ids) {
          if (seen.has(messageId)) continue;
          seen.add(messageId);
          scanned += 1;
          const docId = reportDocId(messageId);
          const existing = await db.collection(REPORTS_COL).doc(docId).get();
          if (existing.exists) {
            const prev = existing.data() || {};
            if (!needsPdfEnrich(prev)) {
              skipped += 1;
              continue;
            }
            try {
              const msg = await getMessage(accessToken, messageId);
              const pdf = await extractPdfTextFromMessage(
                accessToken,
                messageId,
                msg.payload,
              );
              const paths = Array.isArray(pdf.storagePaths) ? pdf.storagePaths : [];
              const names = Array.isArray(pdf.filenames) ? pdf.filenames : [];
              if (!pdf.text) {
                await db.collection(REPORTS_COL).doc(docId).set(
                  {
                    parseStatus: "fail",
                    parseError: pdf.error || "ดึงข้อความ PDF ไม่สำเร็จ",
                    pdfError: pdf.error || "empty",
                    ...(names.length ? { pdfFilenames: names } : {}),
                    ...(paths.length ? { pdfStoragePaths: paths } : {}),
                    syncedAt: Date.now(),
                    syncedBy: actorId,
                    pdfEnrichedAt: Date.now(),
                  },
                  { merge: true },
                );
                if (paths.length) pdfEnriched += 1;
                else skipped += 1;
                continue;
              }
              const rawText = mergeBodyWithPdf(prev.rawText || "", pdf.text, {
                force: true,
              });
              await db.collection(REPORTS_COL).doc(docId).set(
                {
                  rawText,
                  pdfFilenames: names,
                  pdfStoragePaths: paths,
                  pdfError: "",
                  parseStatus: "pending",
                  parseError: "",
                  syncedAt: Date.now(),
                  syncedBy: actorId,
                  pdfEnrichedAt: Date.now(),
                },
                { merge: true },
              );
              pdfEnriched += 1;
            } catch (e) {
              console.warn("pdf enrich", messageId, e?.message || e);
              skipped += 1;
            }
            continue;
          }
          const msg = await getMessage(accessToken, messageId);
          const headers = headerMap(msg.payload?.headers);
          const subject = headers.subject || "";
          const from = headers.from || "";
          const internalDate = Number(msg.internalDate) || Date.now();
          const bodies = collectParts(msg.payload);
          const subjLower = String(subject || "").toLowerCase();
          const excl = (rules[channel] && rules[channel].subjectExcludes) || [];
          if (excl.some((k) => k && subjLower.includes(k))) {
            skipped += 1;
            continue;
          }
          if (isTaxInvoiceMail(subject) || isNoiseMail(from, subject)) {
            skipped += 1;
            continue;
          }
          const matched = matchChannel(from, subject, rules);
          let channelFinal = matched;
          if (matched === "unknown") {
            // ไม่ fallback เป็นช่องค้นหา — กันเมล LM/Grab ที่โผล่จาก query Shopee
            if (!fromHitsSearchChannel(from, rules[channel])) {
              skipped += 1;
              continue;
            }
            channelFinal = channel;
          }
          let rawText = String(bodies.text || "").slice(0, 200000);
          const rawHtml = String(bodies.html || "").slice(0, 200000);
          let pdfFilenames = [];
          let pdfStoragePaths = [];
          let pdfError = "";
          // Grab (และเมลสรุปยอด) — เก็บ PDF + ดึงข้อความใส่ rawText
          if (
            channelFinal === "grab" ||
            /สรุปยอดขาย|grabfood|daily sales/i.test(subject)
          ) {
            try {
              const pdf = await extractPdfTextFromMessage(
                accessToken,
                messageId,
                msg.payload,
              );
              pdfFilenames = Array.isArray(pdf.filenames) ? pdf.filenames : [];
              pdfStoragePaths = Array.isArray(pdf.storagePaths) ? pdf.storagePaths : [];
              if (pdf.text) {
                rawText = mergeBodyWithPdf(rawText, pdf.text);
              } else {
                pdfError = pdf.error || "ดึงข้อความ PDF ไม่สำเร็จ";
              }
            } catch (e) {
              pdfError = asString(e?.message || String(e), 160);
              console.warn("pdf extract", messageId, pdfError);
            }
          }
          const period = periodFieldsFromResolved(
            resolveReportPeriod({
              subject,
              snippet: msg.snippet,
              rawText,
              receivedAt: internalDate,
            }),
          );
          const studyTags = inferMailStudyTags(
            {
              from,
              subject,
              channel: channelFinal,
              pdfFilenames,
              reportKind: period.reportKind,
              snippet: msg.snippet,
              rawText,
            },
            rules,
          );
          await db.collection(REPORTS_COL).doc(docId).set({
            channel: channelFinal,
            provider: "gmail",
            messageId,
            threadId: asString(msg.threadId, 120),
            receivedAt: internalDate,
            internalDate,
            subject: asString(subject, 500),
            from: asString(from, 300),
            snippet: asString(msg.snippet, 400),
            rawText,
            rawHtml,
            ...(pdfFilenames.length ? { pdfFilenames } : {}),
            ...(pdfStoragePaths.length ? { pdfStoragePaths } : {}),
            ...(pdfError ? { pdfError } : { pdfError: "" }),
            ...period,
            studyTags,
            studyTagsUpdatedAt: Date.now(),
            parseStatus: "pending",
            parseError: "",
            syncedAt: Date.now(),
            syncedBy: actorId,
          });
          added += 1;
        }
      }

      const fix = await reclassifyStoredReports(db, rules, actorId);

      await db.doc(OAUTH_DOC).set(
        {
          lastSyncAt: Date.now(),
          lastSyncError: "",
          lastSyncAdded: added,
          lastSyncScanned: scanned,
          lastSyncPdfEnriched: pdfEnriched,
          lastSyncReclassified: fix.reclassified,
          updatedAt: Date.now(),
        },
        { merge: true },
      );

      return {
        ok: true,
        scanned,
        added,
        skipped,
        pdfEnriched,
        reclassified: fix.reclassified,
        noiseTagged: fix.noiseTagged,
        lookbackDays,
      };
    } catch (e) {
      const msg = asString(e?.message || String(e), 300);
      await db.doc(OAUTH_DOC).set(
        {
          lastSyncAt: Date.now(),
          lastSyncError: msg,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      throw new functions.https.HttpsError("internal", `ซิงก์เมลไม่สำเร็จ — ${msg.slice(0, 120)}`);
    }
  });

/** Owner-only signed URL to open a stored mail PDF (Firebase Storage). */
exports.vatMailPdfUrl = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await assertOwner(context);
    const path = asString(data?.path, 500);
    if (!path.startsWith("vat-mail-pdfs/") || path.includes("..")) {
      throw new functions.https.HttpsError("invalid-argument", "พาธ PDF ไม่ถูกต้อง");
    }
    const reportId = asString(data?.reportId, 120);
    if (reportId) {
      const snap = await getFirestore().collection(REPORTS_COL).doc(reportId).get();
      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", "ไม่พบรายงานเมล");
      }
      const paths = Array.isArray(snap.data()?.pdfStoragePaths)
        ? snap.data().pdfStoragePaths
        : [];
      if (!paths.includes(path)) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "PDF นี้ไม่ได้ผูกกับรายงาน",
        );
      }
    }
    const url = await signedPdfReadUrl(path, 60 * 60 * 1000);
    return { ok: true, url, expiresInMinutes: 60 };
  });

exports.DEFAULT_MAIL_RULES = DEFAULT_MAIL_RULES;
