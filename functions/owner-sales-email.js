/**
 * Owner storefront sales email → Gmail (ส่งทันทีเมื่อตัดรอบ / ปิดรอบ POS).
 * Settings: meta/ownerSalesEmail { enabled, recipients[] }
 * Sender: Gmail ที่เชื่อมไว้ในหน้า VAT (meta/vatMailOAuth) — ต้องมี scope gmail.send
 * Idempotent per session: ownerSalesEmailLog/{sessionId} (Admin SDK only)
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { bangkokParts, bangkokDateKeyFromParts } = require("./line-owner");
const {
  OAUTH_DOC,
  loadOAuthConfig,
  refreshAccessToken,
  scopeHasGmailSend,
} = require("./vat-mail");

const REGION = "asia-southeast1";
const OWNER_EMAIL = String(process.env.TELLTEA_OWNER_EMAIL || "yohaken@gmail.com")
  .trim()
  .toLowerCase();
const SETTINGS_DOC = "meta/ownerSalesEmail";
const STATE_DOC = "meta/ownerSalesEmailState";
const LOG_COL = "ownerSalesEmailLog";
const MAX_RECIPIENTS = 5;
/** รอบิลค้างจากแท็บเล็ตซิงก์ขึ้นก่อนสรุป */
const LATE_BILL_WAIT_MS = 20_000;
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function sanitizeRecipients(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,;]+/);
  const out = [];
  for (const item of list) {
    const email = String(item || "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || out.includes(email)) continue;
    out.push(email);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

function parseSalesEmailSettings(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const recipients = d.recipients === undefined ? [OWNER_EMAIL] : sanitizeRecipients(d.recipients);
  return {
    enabled: d.enabled !== false,
    recipients,
  };
}

async function loadSalesEmailSettings(db) {
  const snap = await db.doc(SETTINGS_DOC).get();
  return parseSalesEmailSettings(snap.exists ? snap.data() : undefined);
}

function bangkokDateKey(ms) {
  return bangkokDateKeyFromParts(bangkokParts(ms));
}

function startMsFromDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
}

function normalizePay(raw) {
  const m = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (m === "promptpay") return "promptpay";
  if (m === "transfer" || m === "bank" || m === "bank_transfer") return "transfer";
  return "cash";
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function sumDaySales(db, dateKey) {
  const start = startMsFromDateKey(dateKey);
  const end = start + 24 * 60 * 60 * 1000 - 1;
  const windows = [
    [start, end],
    [start + 7 * 60 * 60 * 1000, end + 7 * 60 * 60 * 1000],
  ];
  const seen = new Set();
  const day = {
    gross: 0,
    bills: 0,
    cash: 0,
    promptpay: 0,
    transfer: 0,
    discount: 0,
    voidedCount: 0,
    voidedTotal: 0,
    sessionIds: new Set(),
    items: new Map(),
  };
  for (const [a, b] of windows) {
    const snap = await db.collection("posSales").where("date", ">=", a).where("date", "<=", b).get();
    for (const docSnap of snap.docs) {
      if (seen.has(docSnap.id)) continue;
      seen.add(docSnap.id);
      const data = docSnap.data() || {};
      const dateMs = typeof data.date === "number" ? data.date : 0;
      if (dateMs && bangkokDateKey(dateMs) !== dateKey) continue;
      const total = Number(data.total) || 0;
      if (data.status === "voided") {
        day.voidedCount += 1;
        day.voidedTotal += total;
        continue;
      }
      if (!(total > 0)) continue;
      day.bills += 1;
      day.gross += total;
      day.discount += Number(data.discountBaht) || 0;
      day[normalizePay(data.paymentMethod)] += total;
      if (typeof data.sessionId === "string" && data.sessionId) day.sessionIds.add(data.sessionId);
      for (const line of Array.isArray(data.lines) ? data.lines : []) {
        const name = String(line?.name || "").trim().slice(0, 60);
        const qty = Number(line?.qty) || 0;
        if (!name || !(qty > 0)) continue;
        const prev = day.items.get(name) || { name, qty: 0, revenue: 0 };
        prev.qty += qty;
        prev.revenue += qty * (Number(line?.price) || 0);
        day.items.set(name, prev);
      }
    }
  }
  const topItems = [...day.items.values()]
    .sort((x, y) => y.qty - x.qty || y.revenue - x.revenue)
    .slice(0, 10)
    .map((r) => ({ ...r, revenue: round2(r.revenue) }));
  return {
    gross: round2(day.gross),
    bills: day.bills,
    cash: round2(day.cash),
    promptpay: round2(day.promptpay),
    transfer: round2(day.transfer),
    discount: round2(day.discount),
    voidedCount: day.voidedCount,
    voidedTotal: round2(day.voidedTotal),
    roundCount: day.sessionIds.size,
    topItems,
  };
}

async function countOpenSessionsForDay(db, dateKey, excludeId) {
  const snap = await db.collection("posSessions").where("status", "==", "open").limit(20).get();
  let n = 0;
  for (const docSnap of snap.docs) {
    if (docSnap.id === excludeId) continue;
    const d = docSnap.data() || {};
    const ms = Number(d.openedAt) || Number(d.date) || 0;
    if (ms && bangkokDateKey(ms) === dateKey) n += 1;
  }
  return n;
}

function fmtBaht(n) {
  return `฿${(Number(n) || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtClock(ms) {
  if (!ms) return "—";
  const p = bangkokParts(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sessionSummary(id, raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const num = (k) => (typeof d[k] === "number" && Number.isFinite(d[k]) ? d[k] : null);
  return {
    id: String(id || ""),
    openedAt: Number(d.openedAt) || 0,
    closedAt: Number(d.closedAt) || 0,
    openedByName: String(d.openedByName || "").slice(0, 60),
    closedByName: String(d.closedByName || "").slice(0, 60),
    closeSource: String(d.closeSource || ""),
    totalSales: num("totalSales"),
    saleCount: num("saleCount"),
    closingCashCounted: num("closingCashCounted"),
    expectedCash: num("expectedCash"),
    cashDifference: num("cashDifference"),
    remitAmount: num("remitAmount"),
    cashOutTotal: num("cashOutTotal"),
    discrepancyNote: String(d.discrepancyNote || "").slice(0, 240),
  };
}

/** Pure — สร้างหัวเรื่อง + เนื้อหา (text/html) จากยอดวันและรอบที่เพิ่งปิด */
function buildSalesEmail({ dateKey, day, session = null, openSessions = 0 }) {
  const subject = `TellTea ยอดขายหน้าร้าน ${dateKey} · ${fmtBaht(day.gross)} (${day.bills} บิล)`;
  const rows = [
    ["ยอดขายรวม", fmtBaht(day.gross)],
    ["จำนวนบิล", `${day.bills} บิล`],
    ["เงินสด", fmtBaht(day.cash)],
    ["พร้อมเพย์", fmtBaht(day.promptpay)],
    ["โอน", fmtBaht(day.transfer)],
    ["ส่วนลดรวม", fmtBaht(day.discount)],
    ["บิลยกเลิก", `${day.voidedCount} บิล (${fmtBaht(day.voidedTotal)})`],
    ["จำนวนรอบขาย", `${day.roundCount} รอบ`],
  ];
  const sessionRows = [];
  if (session) {
    sessionRows.push(["เวลา", `${fmtClock(session.openedAt)} – ${fmtClock(session.closedAt)}`]);
    if (session.openedByName) sessionRows.push(["เปิดรอบโดย", session.openedByName]);
    if (session.closedByName) sessionRows.push(["ปิดรอบโดย", session.closedByName]);
    if (session.closeSource === "bo-force") sessionRows.push(["ปิดจาก", "หลังร้าน"]);
    if (session.totalSales != null) {
      sessionRows.push([
        "ยอดรอบนี้",
        `${fmtBaht(session.totalSales)}${session.saleCount != null ? ` · ${session.saleCount} บิล` : ""}`,
      ]);
    }
    if (session.expectedCash != null) sessionRows.push(["เงินสดที่ควรมี", fmtBaht(session.expectedCash)]);
    if (session.closingCashCounted != null) {
      sessionRows.push(["นับเงินจริง", fmtBaht(session.closingCashCounted)]);
    }
    if (session.cashDifference != null && session.cashDifference !== 0) {
      sessionRows.push(["ส่วนต่าง", fmtBaht(session.cashDifference)]);
    }
    if (session.cashOutTotal) sessionRows.push(["เบิกกลางกะ", fmtBaht(session.cashOutTotal)]);
    if (session.remitAmount != null) sessionRows.push(["ยอดนำส่ง", fmtBaht(session.remitAmount)]);
    if (session.discrepancyNote) sessionRows.push(["หมายเหตุ", session.discrepancyNote]);
  }

  const text = [
    `TellTea ยอดขายหน้าร้าน ${dateKey}`,
    session ? `(ส่งอัตโนมัติเมื่อปิดรอบ ${fmtClock(session.closedAt)})` : "",
    "",
    ...rows.map(([k, v]) => `· ${k}: ${v}`),
    ...(sessionRows.length ? ["", "รอบที่เพิ่งปิด", ...sessionRows.map(([k, v]) => `· ${k}: ${v}`)] : []),
    ...(day.topItems.length
      ? ["", "เมนูขายดี", ...day.topItems.map((r, i) => `${i + 1}. ${r.name} × ${r.qty}`)]
      : []),
    ...(openSessions > 0 ? ["", `⚠ ยังมีรอบเปิดอยู่อีก ${openSessions} รอบ — ยอดอาจยังไม่ครบ`] : []),
    "",
    "เปิดแอป: https://telltea-bo.web.app/",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");

  const tr = ([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(k)}</td>` +
    `<td style="padding:4px 0;font-weight:600;text-align:right">${escapeHtml(v)}</td></tr>`;
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Tahoma,sans-serif;max-width:520px;color:#222">`,
    `<h2 style="margin:0 0 4px;color:#405B4A">TellTea ยอดขายหน้าร้าน ${escapeHtml(dateKey)}</h2>`,
    session
      ? `<p style="margin:0 0 12px;color:#777;font-size:13px">ส่งอัตโนมัติเมื่อปิดรอบ ${escapeHtml(fmtClock(session.closedAt))}</p>`
      : "",
    `<p style="font-size:28px;font-weight:700;margin:8px 0 12px">${escapeHtml(fmtBaht(day.gross))}</p>`,
    `<table style="border-collapse:collapse;width:100%">${rows.map(tr).join("")}</table>`,
    sessionRows.length
      ? `<h3 style="margin:18px 0 6px;color:#405B4A">รอบที่เพิ่งปิด</h3>` +
        `<table style="border-collapse:collapse;width:100%">${sessionRows.map(tr).join("")}</table>`
      : "",
    day.topItems.length
      ? `<h3 style="margin:18px 0 6px;color:#405B4A">เมนูขายดี</h3><ol style="margin:0;padding-left:20px">` +
        day.topItems.map((r) => `<li>${escapeHtml(r.name)} × ${r.qty}</li>`).join("") +
        `</ol>`
      : "",
    openSessions > 0
      ? `<p style="margin:16px 0 0;color:#b45309">⚠ ยังมีรอบเปิดอยู่อีก ${openSessions} รอบ — ยอดอาจยังไม่ครบ</p>`
      : "",
    `<p style="margin:20px 0 0;font-size:13px"><a href="https://telltea-bo.web.app/">เปิดแอป TellTea</a></p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}

function encodeHeaderUtf8(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf8").toString("base64")}?=`;
}

function buildRawMime({ from, to, subject, text, html }) {
  const boundary = `tt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    from ? `From: ${encodeHeaderUtf8("TellTea")} <${from}>` : "",
    `To: ${to.join(", ")}`,
    `Subject: ${encodeHeaderUtf8(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64"),
    `--${boundary}--`,
    "",
  ].filter((l, i) => !(i === 0 && l === ""));
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function sendGmail(db, { to, subject, text, html }) {
  const config = await loadOAuthConfig(db);
  if (!config) throw new Error("ยังไม่ได้ตั้งค่า Gmail OAuth");
  const oauthSnap = await db.doc(OAUTH_DOC).get();
  const oauth = oauthSnap.exists ? oauthSnap.data() || {} : {};
  if (!oauth.refreshToken) throw new Error("ยังไม่ได้เชื่อม Gmail");
  if (!scopeHasGmailSend(oauth.scope)) {
    throw new Error("Gmail ที่เชื่อมไว้ยังไม่มีสิทธิ์ส่งเมล — กดเชื่อม Gmail ใหม่ในหน้าตั้งค่า");
  }
  const accessToken = await refreshAccessToken(config, String(oauth.refreshToken));
  const raw = buildRawMime({ from: String(oauth.email || ""), to, subject, text, html });
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Gmail send failed (${res.status})`);
  return { id: String(json.id || ""), from: String(oauth.email || "") };
}

async function sendSalesEmail(db, { dateKey, session = null, recipients }) {
  const [day, openSessions] = await Promise.all([
    sumDaySales(db, dateKey),
    countOpenSessionsForDay(db, dateKey, session?.id || ""),
  ]);
  const mail = buildSalesEmail({ dateKey, day, session, openSessions });
  const sent = await sendGmail(db, { to: recipients, ...mail });
  return { ...sent, subject: mail.subject, gross: day.gross, bills: day.bills };
}

async function recordState(db, patch) {
  await db.doc(STATE_DOC).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

exports.onPosSessionClosedSalesEmail = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 120 })
  .firestore.document("posSessions/{sessionId}")
  .onWrite(async (change, context) => {
    if (!change.before.exists || !change.after.exists) return null;
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (before.status === "closed" || after.status !== "closed") return null;
    if (after.source === "manual") return null;

    const db = getFirestore();
    const settings = await loadSalesEmailSettings(db);
    if (!settings.enabled || !settings.recipients.length) return null;

    const sessionId = context.params.sessionId;
    const logRef = db.collection(LOG_COL).doc(sessionId);
    try {
      await logRef.create({ status: "pending", createdAt: Date.now() });
    } catch {
      return null;
    }

    await new Promise((r) => setTimeout(r, LATE_BILL_WAIT_MS));
    const freshSnap = await change.after.ref.get();
    const session = sessionSummary(sessionId, freshSnap.exists ? freshSnap.data() : after);
    const dateKey = bangkokDateKey(session.openedAt || Number(after.date) || session.closedAt || Date.now());

    try {
      const result = await sendSalesEmail(db, { dateKey, session, recipients: settings.recipients });
      await logRef.set(
        { status: "sent", sentAt: Date.now(), dateKey, to: settings.recipients, messageId: result.id },
        { merge: true },
      );
      await recordState(db, {
        lastSentAt: Date.now(),
        lastDateKey: dateKey,
        lastSessionId: sessionId,
        lastTo: settings.recipients,
        lastSubject: result.subject,
        lastError: "",
      });
      console.log("onPosSessionClosedSalesEmail sent", sessionId, dateKey, result.gross);
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 300);
      await logRef.set({ status: "error", error: msg, failedAt: Date.now() }, { merge: true });
      await recordState(db, { lastErrorAt: Date.now(), lastError: msg, lastSessionId: sessionId });
      console.error("onPosSessionClosedSalesEmail failed", sessionId, msg);
    }
    return null;
  });

exports.ownerSalesEmailSendNow = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    const { assertOwner } = require("./npos-owner-device");
    await assertOwner(context);
    const db = getFirestore();
    const settings = await loadSalesEmailSettings(db);
    if (!settings.recipients.length) {
      return { ok: false, detail: "ยังไม่ได้ใส่อีเมลผู้รับ — ใส่แล้วกดบันทึกก่อน" };
    }
    const reqKey = typeof data?.dateKey === "string" ? data.dateKey.trim() : "";
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(reqKey) ? reqKey : bangkokDateKey(Date.now());
    try {
      const result = await sendSalesEmail(db, { dateKey, recipients: settings.recipients });
      await recordState(db, {
        lastSentAt: Date.now(),
        lastDateKey: dateKey,
        lastSessionId: "",
        lastTo: settings.recipients,
        lastSubject: result.subject,
        lastError: "",
      });
      return {
        ok: true,
        detail: `ส่งยอดขาย ${dateKey} ไป ${settings.recipients.join(", ")} แล้ว`,
      };
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 300);
      await recordState(db, { lastErrorAt: Date.now(), lastError: msg });
      return { ok: false, detail: msg };
    }
  });

exports._ownerSalesEmailTestOnly = {
  parseSalesEmailSettings,
  sanitizeRecipients,
  buildSalesEmail,
  buildRawMime,
};
