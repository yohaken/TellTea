/**
 * ดึงสรุปเดือนจาก Gmail ตรง ๆ สำหรับหน้าแหล่งนำเข้า (พรีวิว)
 * - ShopeeFood: เนื้อเมลบล็อก「รายงานยอดขายสะสมประจำเดือน」
 * - LINE MAN: ไฟล์แนบ REPORT_*.csv ไฟล์แรกจากเมล GP ประจำเดือน
 * ไม่เขียนเข้างบเดือน
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const {
  listDriveableParts,
  fetchAttachmentBuffer,
  decodeAttachmentData,
} = require("./vat-mail-pdf");

const REGION = "asia-southeast1";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();

const OAUTH_DOC = "meta/vatMailOAuth";
const OAUTH_CONFIG_DOC = "meta/vatMailOAuthConfig";

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

async function loadOAuthConfig(db) {
  const envId = String(process.env.GMAIL_OAUTH_CLIENT_ID || "").trim();
  const envSecret = String(process.env.GMAIL_OAUTH_CLIENT_SECRET || "").trim();
  const envRedirect = String(process.env.GMAIL_OAUTH_REDIRECT_URI || "").trim();
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

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
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

async function listMessageIds(accessToken, q, max = 12) {
  const ids = [];
  let pageToken = "";
  while (ids.length < max) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(Math.min(20, max - ids.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || `list messages failed (${res.status})`);
    }
    for (const m of json.messages || []) {
      if (m.id) ids.push(String(m.id));
      if (ids.length >= max) break;
    }
    pageToken = String(json.nextPageToken || "");
    if (!pageToken) break;
  }
  return ids;
}

async function getMessage(accessToken, id) {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/` +
    `${encodeURIComponent(id)}?format=full`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message || `get message failed (${res.status})`);
  }
  return json;
}

function messageBodyText(msg) {
  const bodies = collectParts(msg.payload);
  const text = String(bodies.text || "").trim();
  if (text) return text.slice(0, 200000);
  return htmlToText(bodies.html).slice(0, 200000);
}

function monthKeyFromShopeeBody(text) {
  const m = String(text || "").match(
    /วันที่รายงาน\s*[:：]?\s*(\d{4}-\d{2}-\d{2})\s*ถึง\s*(\d{4}-\d{2}-\d{2})/,
  );
  return m?.[1] ? m[1].slice(0, 7) : "";
}

function monthKeyFromLinemanSubject(subject) {
  const m = String(subject || "").match(/ประจำเดือน\s*([ก-๙]+)\s+(\d{4})/);
  if (!m) return "";
  const month = THAI_MONTHS[m[1]];
  let year = Number(m[2]);
  if (!month || !year) return "";
  if (year > 2400) year -= 543;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** เมลสรุปเดือนมักเข้าต้นเดือนถัดไป (SF เช้า · LM ~สามทุ่ม) */
function gmailWindowForReportMonth(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return "";
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  if (!y || !m) return "";
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const after = `${y}/${String(m).padStart(2, "0")}/25`;
  const before = `${nextY}/${String(nextM).padStart(2, "0")}/12`;
  return `after:${after} before:${before}`;
}

function looksLikeShopeeMonthly(text) {
  const t = String(text || "");
  return (
    /รายงานยอดขายสะสมประจำเดือน/.test(t) ||
    (/วันที่รายงาน/.test(t) && /ยอดรายการ/.test(t) && /ยอดรวมสุทธิประจำเดือน/.test(t))
  );
}

async function collectShopeeCandidates(accessToken, query) {
  const ids = await listMessageIds(accessToken, query, 20);
  const candidates = [];
  for (const id of ids) {
    const msg = await getMessage(accessToken, id);
    const headers = headerMap(msg.payload && msg.payload.headers);
    const subject = headers.subject || "";
    const from = headers.from || "";
    const text = messageBodyText(msg);
    if (!looksLikeShopeeMonthly(text)) continue;
    const mk = monthKeyFromShopeeBody(text);
    candidates.push({
      messageId: id,
      subject,
      from,
      monthKey: mk,
      text,
      internalDate: Number(msg.internalDate) || 0,
    });
  }
  return candidates;
}

async function pullShopeeMonthly(accessToken, monthKey) {
  // เมลเข้าต้นเดือนถัดไป แต่เดือนจริง = วันที่รายงานในเนื้อหา (เดือนก่อน)
  const base =
    '(from:(noreply.th@shopeefood.com OR shopeefood) OR subject:(ShopeeFood) OR "Kongsi Tea Bar") ' +
    '("รายงานยอดขายสะสมประจำเดือน" OR "รายงานการโอนเงินสำหรับ ShopeeFood" OR "รายงานการโอนเงิน") ';
  const window = gmailWindowForReportMonth(monthKey);
  let candidates = await collectShopeeCandidates(
    accessToken,
    base + (window || "newer_than:400d"),
  );
  if (!candidates.length && window) {
    candidates = await collectShopeeCandidates(accessToken, `${base}newer_than:400d`);
  }
  if (!candidates.length) {
    return {
      ok: false,
      channel: "shopee",
      error: "ไม่พบเมลสรุปเดือน ShopeeFood ในช่วงค้นหา",
    };
  }
  const key = String(monthKey || "").trim();
  let pick = candidates[0];
  if (/^\d{4}-\d{2}$/.test(key)) {
    const matched = candidates.find((c) => c.monthKey === key);
    if (matched) pick = matched;
    else {
      return {
        ok: false,
        channel: "shopee",
        error: `ไม่พบเมล Shopee เดือน ${key} (เจอ ${candidates
          .map((c) => c.monthKey || "?")
          .join(", ")})`,
        scanned: candidates.length,
      };
    }
  }
  return {
    ok: true,
    channel: "shopee",
    kind: "shopee-monthly-mail",
    messageId: pick.messageId,
    subject: pick.subject,
    from: pick.from,
    monthKey: pick.monthKey,
    fileName: "",
    text: pick.text,
    scanned: candidates.length,
    note: "ใช้เนื้อเมล · เดือนจาก「วันที่รายงาน」ไม่ใช่วันส่งเมล",
  };
}

async function collectLinemanCandidates(accessToken, query) {
  const ids = await listMessageIds(accessToken, query, 20);
  const candidates = [];
  for (const id of ids) {
    const msg = await getMessage(accessToken, id);
    const headers = headerMap(msg.payload && msg.payload.headers);
    const subject = headers.subject || "";
    const from = headers.from || "";
    if (!/LINE\s*MAN|GP|ประจำเดือน|lmwn/i.test(`${subject} ${from}`)) continue;
    const mk = monthKeyFromLinemanSubject(subject);
    const parts = listDriveableParts(msg.payload || {});
    const reportPart = parts.find((p) =>
      /^REPORT_[A-Za-z0-9]+\.csv$/i.test(p.filename || ""),
    );
    if (!reportPart) continue;
    candidates.push({
      messageId: id,
      subject,
      from,
      monthKey: mk,
      part: reportPart,
      internalDate: Number(msg.internalDate) || 0,
    });
  }
  return candidates;
}

async function pullLinemanReportCsv(accessToken, monthKey) {
  // เมล GP มักเข้า ~สามทุ่ม ต้นเดือนถัดไป → ย้อนหาช่วงนั้นเพื่อได้เดือนที่เลือก
  const base =
    '(from:(lmwn.com OR "LINE MAN" OR Wongnai) OR subject:(LINE MAN)) ' +
    '("แจ้งค่าบริการระบบ LINE MAN GP ประจำเดือน" OR "ค่าบริการ GP" OR "ประจำเดือน") ' +
    "has:attachment ";
  const window = gmailWindowForReportMonth(monthKey);
  let candidates = await collectLinemanCandidates(
    accessToken,
    base + (window || "newer_than:400d"),
  );
  if (!candidates.length && window) {
    candidates = await collectLinemanCandidates(accessToken, `${base}newer_than:400d`);
  }
  if (!candidates.length) {
    return {
      ok: false,
      channel: "lineman",
      error:
        "ไม่พบเมล LINE MAN GP ที่มีไฟล์ REPORT_*.csv — ถ้าเป็นต้นเดือนอาจรอบ่ายสามทุ่ม",
    };
  }
  const key = String(monthKey || "").trim();
  let pick = candidates[0];
  if (/^\d{4}-\d{2}$/.test(key)) {
    const matched = candidates.find((c) => c.monthKey === key);
    if (matched) pick = matched;
    else {
      return {
        ok: false,
        channel: "lineman",
        error: `ไม่พบเมล LM เดือน ${key} (เจอ ${candidates
          .map((c) => c.monthKey || "?")
          .join(", ")})`,
        scanned: candidates.length,
      };
    }
  }

  let buf;
  if (pick.part.inlineData) {
    buf = decodeAttachmentData(pick.part.inlineData);
  } else {
    buf = await fetchAttachmentBuffer(
      accessToken,
      pick.messageId,
      pick.part.attachmentId,
    );
  }
  const text = buf.toString("utf8");
  return {
    ok: true,
    channel: "lineman",
    kind: "lineman-report-csv",
    messageId: pick.messageId,
    subject: pick.subject,
    from: pick.from,
    monthKey: pick.monthKey,
    fileName: pick.part.filename || "REPORT.csv",
    text,
    scanned: candidates.length,
    note: "อ่าน REPORT_*.csv ไฟล์แรก · เดือนจากหัวข้อเมล GP ประจำเดือน",
  };
}

exports.vatMailPullMonthlySources = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .https.onCall(async (data, context) => {
    await assertOwner(context);
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
        "ยังไม่ได้เชื่อม Gmail — กด「เชื่อม Gmail」ก่อน",
      );
    }
    const refreshToken = asString(oauthSnap.get("refreshToken"), 500);
    const monthKey = asString(data?.monthKey, 7);
    const wantShopee = data?.shopee !== false;
    const wantLineman = data?.lineman !== false;

    try {
      const accessToken = await refreshAccessToken(config, refreshToken);
      const result = {
        ok: true,
        monthKey: monthKey || "",
        shopee: null,
        lineman: null,
      };
      if (wantShopee) {
        result.shopee = await pullShopeeMonthly(accessToken, monthKey);
      }
      if (wantLineman) {
        result.lineman = await pullLinemanReportCsv(accessToken, monthKey);
      }
      return result;
    } catch (e) {
      if (e instanceof functions.https.HttpsError) throw e;
      throw new functions.https.HttpsError(
        "internal",
        asString(e?.message || String(e), 300),
      );
    }
  });
