/**
 * Asia/Bangkok calendar day → epoch ms at 00:00+07 (same as BO startOfLocalDay in Thailand).
 * Do NOT use toLocaleString+setHours on UTC hosts — that yields UTC midnight.
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bangkokCalendarParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || "0";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
  };
}

function startOfBangkokDay(now = Date.now()) {
  const { y, m, d } = bangkokCalendarParts(now);
  return Date.UTC(y, m - 1, d) - BANGKOK_OFFSET_MS;
}

module.exports = { startOfBangkokDay, bangkokCalendarParts, BANGKOK_OFFSET_MS };
