/**
 * VAT mail — Gmail OAuth + sync platform daily reports (owner-only).
 * Tokens: meta/vatMailOAuth · OAuth client: env or meta/vatMailOAuthConfig
 *   GMAIL_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI
 */
const functions = require("firebase-functions/v1");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

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
    subjectIncludes: ["shopee", "shopeefood", "สรุปยอด", "ยอดขาย"],
  },
  grab: {
    enabled: true,
    fromIncludes: ["grab.com", "grabfood"],
    subjectIncludes: ["grab", "รายงาน", "สรุป", "sales", "settlement"],
  },
  lineman: {
    enabled: true,
    fromIncludes: ["lineman", "line.me", "linedelivery"],
    subjectIncludes: ["lineman", "line man", "สรุป", "ยอดขาย", "รายงาน"],
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
  return {
    enabled: o.enabled !== false,
    fromIncludes: list(o.fromIncludes, fallback.fromIncludes),
    subjectIncludes: list(o.subjectIncludes, fallback.subjectIncludes),
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
    const fromHit = rule.fromIncludes.some((k) => f.includes(k));
    const subHit = rule.subjectIncludes.some((k) => s.includes(k));
    if (fromHit || subHit) return channel;
  }
  return "unknown";
}

function buildSearchQuery(rule, lookbackDays) {
  const after = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const y = after.getUTCFullYear();
  const m = String(after.getUTCMonth() + 1).padStart(2, "0");
  const d = String(after.getUTCDate()).padStart(2, "0");
  const parts = [`after:${y}/${m}/${d}`];
  const orTerms = [];
  for (const t of rule.fromIncludes.slice(0, 3)) {
    if (t.includes("@") || t.includes(".")) orTerms.push(`from:${t}`);
    else orTerms.push(`from:${t}`);
  }
  for (const t of rule.subjectIncludes.slice(0, 3)) {
    orTerms.push(`subject:${t}`);
  }
  if (orTerms.length) parts.push(`(${orTerms.join(" OR ")})`);
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

function guessReportDate(subject, internalDateMs) {
  const s = String(subject || "");
  const m = s.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, "0");
    const d = String(m[3]).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const m2 = s.match(/(\d{1,2})[./](\d{1,2})[./](20\d{2})/);
  if (m2) {
    const d = String(m2[1]).padStart(2, "0");
    const mo = String(m2[2]).padStart(2, "0");
    return `${m2[3]}-${mo}-${d}`;
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
            skipped += 1;
            continue;
          }
          const msg = await getMessage(accessToken, messageId);
          const headers = headerMap(msg.payload?.headers);
          const subject = headers.subject || "";
          const from = headers.from || "";
          const internalDate = Number(msg.internalDate) || Date.now();
          const bodies = collectParts(msg.payload);
          const matched = matchChannel(from, subject, rules);
          const channelFinal = matched === "unknown" ? channel : matched;
          const rawText = String(bodies.text || "").slice(0, 200000);
          const rawHtml = String(bodies.html || "").slice(0, 200000);
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
          updatedAt: Date.now(),
        },
        { merge: true },
      );

      return { ok: true, scanned, added, skipped, lookbackDays };
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
