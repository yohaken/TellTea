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
} = require("./vat-mail-pdf");

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
const DEFAULT_LOOKBACK_DAYS = 31;
const MAX_MESSAGES_PER_SYNC = 80;

function reportDocId(messageId) {
  const safe = String(messageId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `gmail_${safe || crypto.randomBytes(8).toString("hex")}`;
}

const DEFAULT_MAIL_RULES = {
  shopee: {
    enabled: true,
    fromIncludes: ["shopee", "shopeefood"],
    subjectIncludes: ["shopeefood", "สรุปยอด", "ยอดขาย", "รายงานยอด"],
    subjectExcludes: ["otp", "verify"],
  },
  grab: {
    enabled: true,
    fromIncludes: ["grab.com", "grabfood"],
    subjectIncludes: [
      "สรุปยอดขาย",
      "grabfood",
      "daily sales",
      "รายงานยอดขาย",
      "sales summary",
    ],
    subjectExcludes: [
      "tax invoice",
      "ใบกำกับภาษี",
      "receipt/tax",
      "receipt / tax",
      "ใบเสร็จ",
    ],
  },
  lineman: {
    enabled: true,
    fromIncludes: ["lineman", "wongnai", "line.me"],
    subjectIncludes: [
      "รายงานยอดขายรายวัน",
      "line man",
      "lineman",
      "wongnai",
      "สรุปยอด",
      "ยอดขายรายวัน",
    ],
    subjectExcludes: ["otp", "verify"],
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

function publicOAuthStatus(oauthData, hasConfig) {
  const connected = Boolean(oauthData && oauthData.refreshToken);
  return {
    hasConfig: Boolean(hasConfig),
    connected,
    provider: connected ? "gmail" : null,
    email: connected ? asString(oauthData.email, 120) : "",
    connectedAt: connected ? Number(oauthData.connectedAt) || 0 : 0,
    lastSyncAt: connected ? Number(oauthData.lastSyncAt) || 0 : 0,
    lastSyncError: connected ? asString(oauthData.lastSyncError, 300) : "",
    lastSyncAdded: connected ? Number(oauthData.lastSyncAdded) || 0 : 0,
  };
}

function appReturnUrl(base, query) {
  const root = asString(base, 400) || "https://telltea-shop.web.app/vat-sales/";
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

function normalizeRule(raw, fallback) {
  const o = raw && typeof raw === "object" ? raw : {};
  const list = (v, fb) => {
    if (Array.isArray(v) && v.length) {
      return v.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20);
    }
    return [...fb];
  };
  const excludes =
    Array.isArray(o.subjectExcludes) && o.subjectExcludes.length
      ? o.subjectExcludes.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [...(fallback.subjectExcludes || [])];
  return {
    enabled: o.enabled !== false,
    fromIncludes: list(o.fromIncludes, fallback.fromIncludes),
    subjectIncludes: list(o.subjectIncludes, fallback.subjectIncludes),
    subjectExcludes: excludes,
  };
}

function loadMailRules(settings) {
  const raw = settings && settings.mailRules && typeof settings.mailRules === "object"
    ? settings.mailRules
    : {};
  return {
    shopee: normalizeRule(raw.shopee, DEFAULT_MAIL_RULES.shopee),
    grab: normalizeRule(raw.grab, DEFAULT_MAIL_RULES.grab),
    lineman: normalizeRule(raw.lineman, DEFAULT_MAIL_RULES.lineman),
  };
}

function matchChannel(from, subject, rules) {
  const f = String(from || "").toLowerCase();
  const s = String(subject || "").toLowerCase();
  for (const channel of ["shopee", "grab", "lineman"]) {
    const rule = rules[channel];
    if (!rule || rule.enabled === false) continue;
    const excludes = rule.subjectExcludes || [];
    if (excludes.some((k) => k && s.includes(k))) continue;
    const fromHit = rule.fromIncludes.some((k) => f.includes(k));
    const subHit = rule.subjectIncludes.some((k) => s.includes(k));
    // เงินเข้า: ต้องมีคำในหัวข้อ (กันเมลใบกำกับจาก grab.com)
    if (subHit) return channel;
    if (fromHit && /(ยอดขาย|สรุปยอด|daily sales|sales report|รายงานยอด|sales summary)/i.test(s)) {
      return channel;
    }
  }
  return "unknown";
}

function buildSearchQuery(rule, lookbackDays) {
  const after = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const y = after.getUTCFullYear();
  const m = String(after.getUTCMonth() + 1).padStart(2, "0");
  const d = String(after.getUTCDate()).padStart(2, "0");
  const parts = [`after:${y}/${m}/${d}`];
  const fromTerms = rule.fromIncludes.slice(0, 4).map((t) => `from:${t}`);
  const subTerms = rule.subjectIncludes.slice(0, 5).map((t) => {
    const q = String(t).includes(" ") ? `"${t}"` : t;
    return `subject:${q}`;
  });
  if (fromTerms.length) parts.push(`(${fromTerms.join(" OR ")})`);
  if (subTerms.length) parts.push(`(${subTerms.join(" OR ")})`);
  for (const ex of (rule.subjectExcludes || []).slice(0, 5)) {
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
    const [oauthSnap, config] = await Promise.all([
      db.doc(OAUTH_DOC).get(),
      loadOAuthConfig(db),
    ]);
    return {
      ...publicOAuthStatus(oauthSnap.exists ? oauthSnap.data() : null, Boolean(config)),
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
    const returnTo = asString(data?.returnTo, 400) || "https://telltea-shop.web.app/vat-sales/";
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
    url.searchParams.set("scope", GMAIL_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("state", state);
    return { url: url.toString() };
  });

exports.vatMailOAuthCallback = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    const db = getFirestore();
    let returnTo = "https://telltea-shop.web.app/vat-sales/";
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
            scope: GMAIL_SCOPE,
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
            scope: GMAIL_SCOPE,
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
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
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
      90,
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
        const rule = rules[channel];
        if (!rule.enabled) continue;
        const q = buildSearchQuery(rule, lookbackDays);
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
              if (!pdf.text) {
                await db.collection(REPORTS_COL).doc(docId).set(
                  {
                    parseStatus: "fail",
                    parseError: pdf.error || "ดึงข้อความ PDF ไม่สำเร็จ",
                    pdfError: pdf.error || "empty",
                    syncedAt: Date.now(),
                    syncedBy: actorId,
                  },
                  { merge: true },
                );
                skipped += 1;
                continue;
              }
              const rawText = mergeBodyWithPdf(prev.rawText || "", pdf.text, {
                force: true,
              });
              await db.collection(REPORTS_COL).doc(docId).set(
                {
                  rawText,
                  pdfFilenames: pdf.filenames,
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
          if (/tax\s*invoice|ใบกำกับภาษี|receipt\s*\/\s*tax|receipt\/tax/.test(subjLower)) {
            skipped += 1;
            continue;
          }
          const matched = matchChannel(from, subject, rules);
          const channelFinal = matched === "unknown" ? channel : matched;
          let rawText = String(bodies.text || "").slice(0, 200000);
          const rawHtml = String(bodies.html || "").slice(0, 200000);
          let pdfFilenames = [];
          let pdfError = "";
          // Grab (และเมลสรุปยอด) — ดึงข้อความจาก PDF แนบมาใส่ rawText
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
              if (pdf.text) {
                rawText = mergeBodyWithPdf(rawText, pdf.text);
                pdfFilenames = pdf.filenames;
              } else {
                pdfError = pdf.error || "ดึงข้อความ PDF ไม่สำเร็จ";
              }
            } catch (e) {
              pdfError = asString(e?.message || String(e), 160);
              console.warn("pdf extract", messageId, pdfError);
            }
          }
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
            ...(pdfError ? { pdfError } : { pdfError: "" }),
            reportDateGuess: guessReportDate(subject, internalDate),
            reportKind: guessReportKind(subject),
            parseStatus: "pending",
            parseError: "",
            syncedAt: Date.now(),
            syncedBy: actorId,
          });
          added += 1;
        }
      }

      await db.doc(OAUTH_DOC).set(
        {
          lastSyncAt: Date.now(),
          lastSyncError: "",
          lastSyncAdded: added,
          lastSyncScanned: scanned,
          lastSyncPdfEnriched: pdfEnriched,
          updatedAt: Date.now(),
        },
        { merge: true },
      );

      return { ok: true, scanned, added, skipped, pdfEnriched, lookbackDays };
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

exports.DEFAULT_MAIL_RULES = DEFAULT_MAIL_RULES;
