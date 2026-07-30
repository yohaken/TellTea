/**
 * Ledger dates: coerce mixed Firestore types + sort Bangkok day newest→oldest.
 * Pattern from production: string/timestamp block then number block (7/7 then 24/7).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const utils = read("src/lib/utils.ts");
const smart = read("src/lib/smart-search.ts");
const cell = read("src/components/SheetDateCell.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(utils, /export function toEpochMs/);
assert.match(utils, /export function accountingDayMs/);
assert.match(utils, /value > 1e11/);
assert.match(utils, /T00:00:00\+07:00/);
assert.match(smart, /accountingDayMs\(a\.date\)/);
assert.match(smart, /bDay - aDay/);
assert.match(cell, /formatDateShort/);
assert.doesNotMatch(cell, /date-stack-yy/);
assert.match(css, /sheet-date-cell/);
assert.doesNotMatch(css, /\.date-stack-yy\b/);
assert.match(version, /APP_BUILD = 475/);

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e11) return value;
    if (value > 1e9) return Math.round(value * 1000);
    if (value > 20000 && value < 100000) {
      return Math.round((value - 25569) * 86400 * 1000);
    }
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) return toEpochMs(Number(t));
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const ms = Date.parse(`${t}T00:00:00+07:00`);
      return Number.isFinite(ms) ? ms : 0;
    }
    const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
      let y = Number(slash[3]);
      if (y < 100) y += 2000;
      const day = Number(slash[1]);
      const month = Number(slash[2]);
      const ms = Date.parse(
        `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`,
      );
      return Number.isFinite(ms) ? ms : 0;
    }
  }
  if (value && typeof value === "object") {
    if (typeof value.toMillis === "function") return value.toMillis();
    const seconds = value.seconds ?? value._seconds;
    if (seconds != null) return Number(seconds) * 1000;
  }
  return 0;
}

function startOfLocalDay(ms) {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  return Date.parse(`${key}T00:00:00+07:00`);
}

function accountingDayMs(value) {
  const ms = toEpochMs(value);
  return ms ? startOfLocalDay(ms) : 0;
}

function formatDateShort(ms) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${Number(get("day"))}/${Number(get("month"))}/${get("year")}`;
}

function sortByDateNewestFirst(rows) {
  return [...rows].sort((a, b) => {
    const aDay = accountingDayMs(a.date);
    const bDay = accountingDayMs(b.date);
    if (aDay !== bDay) return bDay - aDay;
    return toEpochMs(b.createdAt) - toEpochMs(a.createdAt);
  });
}

// Reproduce production mixed-type order from Firestore DESC, then client-sort.
const mixed = [
  { id: "s29", date: "2026-07-29", createdAt: 100 },
  { id: "s28", date: "2026-07-28", createdAt: 99 },
  { id: "s17", date: "2026-07-17", createdAt: 98 },
  { id: "s7", date: "2026-07-07", createdAt: 97 },
  { id: "n24", date: Date.parse("2026-07-24T00:00:00+07:00"), createdAt: 50 },
  { id: "n22", date: Date.parse("2026-07-22T00:00:00+07:00"), createdAt: 49 },
  { id: "n21", date: Date.parse("2026-07-21T00:00:00+07:00"), createdAt: 48 },
];

assert.deepEqual(
  sortByDateNewestFirst(mixed).map((r) => r.id),
  ["s29", "s28", "n24", "n22", "n21", "s17", "s7"],
);
assert.deepEqual(
  sortByDateNewestFirst(mixed).map((r) => formatDateShort(toEpochMs(r.date))),
  ["29/7/26", "28/7/26", "24/7/26", "22/7/26", "21/7/26", "17/7/26", "7/7/26"],
);

// Timestamp-like object
assert.equal(
  formatDateShort(toEpochMs({ seconds: Date.parse("2026-07-24T00:00:00+07:00") / 1000, nanoseconds: 0 })),
  "24/7/26",
);

console.log("OK test-ledger-date-newest-first");
