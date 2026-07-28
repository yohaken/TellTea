/**
 * Outlook / Hotmail mail OAuth + sync via Microsoft Graph (owner-only).
 * Parallel to Gmail — tokens in meta/vatMailOAuthOutlook.
 *
 * Config: env OUTLOOK_OAUTH_* หรือ meta/vatMailOAuthConfigOutlook
 */
const functions = require("firebase-functions/v1");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

const REGION = "asia-southeast1";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

const OAUTH_DOC = "meta/vatMailOAuthOutlook";
const OAUTH_CONFIG_DOC = "meta/vatMailOAuthConfigOutlook";
const OAUTH_STATE_DOC = "meta/vatMailOAuthStateOutlook";
const SETTINGS_DOC = "meta/vatSalesSettings";
const REPORTS_COL = "platformEmailReports";

const GRAPH_SCOPE = "offline_access Mail.Read User.Read";
const DEFAULT_LOOKBACK_DAYS = 31;
const MAX_MESSAGES = 60;

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

async function assertOwner(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");
  }
  const email = asString(context.auth.token?.email, 120).toLowerCase();
  if (email && email === OWNER_EMAIL) return { actorId: email };
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

async function loadConfig(db) {
  const envId = String(process.env.OUTLOOK_OAUTH_CLIENT_ID || "").trim();
  const envSecret = String(process.env.OUTLOOK_OAUTH_CLIENT_SECRET || "").trim();
  const envRedirect = String(process.env.OUTLOOK_OAUTH_REDIRECT_URI || "").trim();
  if (envId && envSecret && envRedirect) {
    return { clientId: envId, clientSecret: envSecret, redirectUri: envRedirect };
  }
  const snap = await db.doc(OAUTH_CONFIG_DOC).get();
  const data = snap.exists ? snap.data() : {};
  const clientId = asString(data.clientId, 200);
  const clientSecret = asString(data.clientSecret, 200);
  const redirectUri = asString(data.redirectUri, 400);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function publicStatus(oauth, hasConfig) {
  const connected = Boolean(oauth && oauth.refreshToken);
  return {
    hasConfig: Boolean(hasConfig),
    connected,
    provider: connected ? "outlook" : null,
    email: connected ? asString(oauth.email, 120) : "",
    connectedAt: connected ? Number(oauth.connectedAt) || 0 : 0,
    lastSyncAt: connected ? Number(oauth.lastSyncAt) || 0 : 0,
    lastSyncError: connected ? asString(oauth.lastSyncError, 300) : "",
    lastSyncAdded: connected ? Number(oauth.lastSyncAdded) || 0 : 0,
  };
}

function appReturnUrl(base, query) {
  const root = asString(base, 400) || "https://mypeer-501909.web.app/vat-sales/";
  const url = new URL(root.includes("://") ? root : `https://mypeer-501909.web.app${root}`);
  if (!url.pathname.includes("vat-sales")) url.pathname = "/vat-sales/";
  Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url.toString();
}

async function exchangeCode(config, code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    scope: GRAPH_SCOPE,
  });
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `token ${res.status}`);
  return json;
}

async function refreshAccess(config, refreshToken) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: GRAPH_SCOPE,
  });
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `refresh ${res.status}`);
  }
  return json;
}

async function graphMe(accessToken) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `me ${res.status}`);
  return asString(json.mail || json.userPrincipalName, 120).toLowerCase();
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

function guessReportKind(subject) {
  const hay = String(subject || "").toLowerCase();
  if (/รายเดือน|monthly|ประจำเดือน/.test(hay)) return "monthly";
  if (/รายสัปดาห์|weekly|สัปดาห์/.test(hay)) return "weekly";
  return "daily";
}

function guessReportDate(subject, receivedAt) {
  const s = String(subject || "");
  const m = s.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  return bangkokDateKey(receivedAt || Date.now());
}

function normalizeRule(raw, fallback) {
  const o = raw && typeof raw === "object" ? raw : {};
  const list = (v, fb) =>
    Array.isArray(v) && v.length
      ? v.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [...fb];
  return {
    enabled: o.enabled !== false,
    fromIncludes: list(o.fromIncludes, fallback.fromIncludes),
    subjectIncludes: list(o.subjectIncludes, fallback.subjectIncludes),
  };
}

function loadMailRules(settings) {
  const raw = settings?.mailRules && typeof settings.mailRules === "object" ? settings.mailRules : {};
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
    if (!rule?.enabled) continue;
    if (rule.fromIncludes.some((k) => f.includes(k)) || rule.subjectIncludes.some((k) => s.includes(k))) {
      return channel;
    }
  }
  return "unknown";
}

function buildGraphFilter(rule, lookbackDays) {
  const after = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  // Graph $search is simpler for subject/from free text
  const terms = [...rule.fromIncludes.slice(0, 2), ...rule.subjectIncludes.slice(0, 2)];
  const search = terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
  return { after, search: search || "sales" };
}

function reportDocId(messageId) {
  const safe = String(messageId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `outlook_${safe || crypto.randomBytes(8).toString("hex")}`;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

exports.vatOutlookStatus = functions.region(REGION).https.onCall(async (_data, context) => {
  const { actorId } = await assertOwner(context);
  const db = getFirestore();
  const [oauthSnap, config] = await Promise.all([db.doc(OAUTH_DOC).get(), loadConfig(db)]);
  return {
    ...publicStatus(oauthSnap.exists ? oauthSnap.data() : null, Boolean(config)),
    actorId,
  };
});

exports.vatOutlookOAuthStart = functions.region(REGION).https.onCall(async (data, context) => {
  const { actorId } = await assertOwner(context);
  const db = getFirestore();
  const config = await loadConfig(db);
  if (!config) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "ยังไม่ได้ตั้งค่า Outlook OAuth (OUTLOOK_OAUTH_* หรือ meta/vatMailOAuthConfigOutlook)",
    );
  }
  const returnTo = asString(data?.returnTo, 400) || "https://mypeer-501909.web.app/vat-sales/";
  const state = crypto.randomBytes(24).toString("hex");
  await db.doc(OAUTH_STATE_DOC).set({ state, actorId, returnTo, createdAt: Date.now() });
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", GRAPH_SCOPE);
  url.searchParams.set("state", state);
  return { url: url.toString() };
});

exports.vatOutlookOAuthCallback = functions.region(REGION).https.onRequest(async (req, res) => {
  const db = getFirestore();
  let returnTo = "https://mypeer-501909.web.app/vat-sales/";
  try {
    const code = asString(req.query.code, 2000);
    const state = asString(req.query.state, 120);
    const err = asString(req.query.error, 120);
    const stateSnap = await db.doc(OAUTH_STATE_DOC).get();
    const stateData = stateSnap.exists ? stateSnap.data() : null;
    if (stateData?.returnTo) returnTo = asString(stateData.returnTo, 400) || returnTo;
    if (err) {
      res.redirect(appReturnUrl(returnTo, { mail: "error", provider: "outlook", reason: err, tab: "mail" }));
      return;
    }
    if (!code || !state || !stateData || stateData.state !== state) {
      res.redirect(appReturnUrl(returnTo, { mail: "error", provider: "outlook", reason: "invalid_state", tab: "mail" }));
      return;
    }
    const config = await loadConfig(db);
    if (!config) {
      res.redirect(appReturnUrl(returnTo, { mail: "error", provider: "outlook", reason: "no_config", tab: "mail" }));
      return;
    }
    const tokenJson = await exchangeCode(config, code);
    if (!tokenJson.refresh_token && !tokenJson.access_token) {
      res.redirect(appReturnUrl(returnTo, { mail: "error", provider: "outlook", reason: "no_token", tab: "mail" }));
      return;
    }
    const email = await graphMe(tokenJson.access_token);
    const prev = await db.doc(OAUTH_DOC).get();
    const refreshToken =
      tokenJson.refresh_token || (prev.exists ? asString(prev.get("refreshToken"), 2000) : "");
    if (!refreshToken) {
      res.redirect(appReturnUrl(returnTo, { mail: "error", provider: "outlook", reason: "no_refresh_token", tab: "mail" }));
      return;
    }
    await db.doc(OAUTH_DOC).set(
      {
        provider: "outlook",
        email,
        refreshToken,
        scope: GRAPH_SCOPE,
        connectedAt: Date.now(),
        connectedBy: asString(stateData.actorId, 120),
        lastSyncError: "",
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    await db.doc(OAUTH_STATE_DOC).delete().catch(() => undefined);
    res.redirect(appReturnUrl(returnTo, { mail: "connected", provider: "outlook", tab: "mail" }));
  } catch (e) {
    console.error("vatOutlookOAuthCallback", e);
    res.redirect(
      appReturnUrl(returnTo, {
        mail: "error",
        provider: "outlook",
        reason: asString(e?.message || "callback_failed", 80),
        tab: "mail",
      }),
    );
  }
});

exports.vatOutlookDisconnect = functions.region(REGION).https.onCall(async (_data, context) => {
  await assertOwner(context);
  await getFirestore().doc(OAUTH_DOC).delete().catch(() => undefined);
  return { ok: true };
});

exports.vatOutlookSync = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data, context) => {
    const { actorId } = await assertOwner(context);
    const db = getFirestore();
    const config = await loadConfig(db);
    if (!config) {
      throw new functions.https.HttpsError("failed-precondition", "ยังไม่ได้ตั้งค่า Outlook OAuth");
    }
    const oauthSnap = await db.doc(OAUTH_DOC).get();
    if (!oauthSnap.exists || !oauthSnap.get("refreshToken")) {
      throw new functions.https.HttpsError("failed-precondition", "ยังไม่ได้เชื่อม Outlook");
    }
    const lookbackDays = Math.min(90, Math.max(1, Number(data?.lookbackDays) || DEFAULT_LOOKBACK_DAYS));
    try {
      const tokenJson = await refreshAccess(config, asString(oauthSnap.get("refreshToken"), 2000));
      const accessToken = tokenJson.access_token;
      if (tokenJson.refresh_token) {
        await db.doc(OAUTH_DOC).set({ refreshToken: tokenJson.refresh_token, updatedAt: Date.now() }, { merge: true });
      }
      const settingsSnap = await db.doc(SETTINGS_DOC).get();
      const settings = settingsSnap.exists ? settingsSnap.data() : {};
      const rules = loadMailRules(settings);
      const channelsEnabled = settings.channelsEnabled || {};

      let scanned = 0;
      let added = 0;
      let skipped = 0;
      const seen = new Set();

      for (const channel of ["shopee", "grab", "lineman"]) {
        if (channelsEnabled[channel] === false) continue;
        const rule = rules[channel];
        if (!rule.enabled) continue;
        const { after, search } = buildGraphFilter(rule, lookbackDays);
        const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
        url.searchParams.set("$top", String(Math.min(25, MAX_MESSAGES)));
        url.searchParams.set("$select", "id,subject,from,receivedDateTime,bodyPreview,body");
        url.searchParams.set("$orderby", "receivedDateTime desc");
        url.searchParams.set("$filter", `receivedDateTime ge ${after}`);
        url.searchParams.set("$search", search);

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ConsistencyLevel: "eventual",
          },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          // fallback without $search if tenant blocks
          console.warn("outlook list failed", channel, json.error?.message);
          continue;
        }
        for (const msg of json.value || []) {
          const messageId = asString(msg.id, 200);
          if (!messageId || seen.has(messageId)) continue;
          seen.add(messageId);
          scanned += 1;
          const docId = reportDocId(messageId);
          const existing = await db.collection(REPORTS_COL).doc(docId).get();
          if (existing.exists) {
            skipped += 1;
            continue;
          }
          const subject = asString(msg.subject, 500);
          const from = asString(msg.from?.emailAddress?.address || msg.from?.emailAddress?.name, 300);
          const receivedAt = Date.parse(msg.receivedDateTime) || Date.now();
          const rawHtml = asString(msg.body?.content, 200000);
          const rawText = msg.body?.contentType === "text" ? rawHtml : stripHtml(rawHtml);
          const matched = matchChannel(from, subject, rules);
          await db.collection(REPORTS_COL).doc(docId).set({
            channel: matched === "unknown" ? channel : matched,
            provider: "outlook",
            messageId,
            receivedAt,
            subject,
            from,
            snippet: asString(msg.bodyPreview, 400),
            rawText: String(rawText || "").slice(0, 200000),
            rawHtml: String(rawHtml || "").slice(0, 200000),
            reportDateGuess: guessReportDate(subject, receivedAt),
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
        { lastSyncAt: Date.now(), lastSyncError: msg, updatedAt: Date.now() },
        { merge: true },
      );
      throw new functions.https.HttpsError("internal", `ซิงก์ Outlook ไม่สำเร็จ — ${msg.slice(0, 120)}`);
    }
  });
