/**
 * Shared LINE Messaging API helpers for owner alerts.
 */
function bangkokParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "0";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function bangkokDateKeyFromParts({ y, m, d }) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function clampHour(n, fallback = 8) {
  const h = Math.round(Number(n));
  if (!Number.isFinite(h)) return fallback;
  return Math.min(23, Math.max(0, h));
}

function formatBaht(n) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

/** Inclusive Bangkok hour window; supports overnight (e.g. 22–6). */
function hourInWindow(hour, start, end) {
  const h = clampHour(hour, 0);
  const s = clampHour(start, 8);
  const e = clampHour(end, 21);
  if (s <= e) return h >= s && h <= e;
  return h >= s || h <= e;
}

function parseNotify(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    channelAccessToken: String(d.channelAccessToken || "").trim(),
    lineUserId: String(d.lineUserId || "").trim(),
    /** Instant condition alerts (low balance) → LINE */
    instantLineEnabled: d.instantLineEnabled !== false,
    instantHourStart: clampHour(d.instantHourStart, 8),
    instantHourEnd: clampHour(d.instantHourEnd, 21),
    dailyDigestEnabled: d.dailyDigestEnabled !== false,
    digestHour: clampHour(d.digestHour, 8),
    includeLowBalance: d.includeLowBalance !== false,
    includeBillNotices: d.includeBillNotices !== false,
    includeYesterdaySales: d.includeYesterdaySales !== false,
    includeMemberCount: d.includeMemberCount !== false,
    /** Optional secondary channel — LINE is primary */
    webPushOnDigest: d.webPushOnDigest === true,
    webPushOnInstant: d.webPushOnInstant === true,
  };
}

async function sendLinePush(token, userId, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: String(text).slice(0, 4900) }],
    }),
  });
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`LINE ${res.status}: ${bodyText.slice(0, 240)}`);
  }
  return { ok: true };
}

async function loadOwnerNotify(db) {
  const snap = await db.doc("meta/ownerLineNotify").get();
  return parseNotify(snap.exists ? snap.data() : {});
}

module.exports = {
  bangkokParts,
  bangkokDateKeyFromParts,
  clampHour,
  formatBaht,
  hourInWindow,
  parseNotify,
  sendLinePush,
  loadOwnerNotify,
};
