/**
 * Ledger / owner-books UI lists must always show Asia/Bangkok date newest → oldest
 * (including search pools + mixed UTC/Bangkok midnight storage).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const smart = read("src/lib/smart-search.ts");
const utils = read("src/lib/utils.ts");
const ledgerPage = read("src/app/ledger/page.tsx");
const ownerPage = read("src/app/owner-books/page.tsx");
const version = read("src/lib/version.ts");
const ledgerLib = read("src/lib/ledger.ts");

assert.match(utils, /export function toEpochMs/);
assert.match(utils, /export function bangkokDateKey/);
assert.match(utils, /timeZone: "Asia\/Bangkok"/);
assert.match(utils, /T00:00:00\+07:00/);

assert.match(smart, /export function sortByDateNewestFirst/);
assert.match(smart, /bangkokDateKey\(toEpochMs/);
assert.match(smart, /bKey\.localeCompare\(aKey\)/);

assert.match(ledgerPage, /sortByDateNewestFirst\(filterLedgerRows/);
assert.match(ownerPage, /sortByDateNewestFirst\(filterOwnerBookRows/);
assert.match(ledgerLib, /date: toEpochMs/);
assert.match(ledgerLib, /orderBy\("date", "desc"\)/);

assert.match(version, /APP_BUILD = 463/);

// Runtime: Bangkok day key beats raw ms when midnights are mixed.
function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}
function bangkokDateKey(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
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
    const aKey = bangkokDateKey(toEpochMs(a.date));
    const bKey = bangkokDateKey(toEpochMs(b.date));
    if (aKey !== bKey) return bKey.localeCompare(aKey);
    return toEpochMs(b.createdAt) - toEpochMs(a.createdAt);
  });
}

const bkk30 = Date.parse("2026-07-30T00:00:00+07:00");
const utc30 = Date.UTC(2026, 6, 30); // 07:00 BKK same calendar day
const bkk29 = Date.parse("2026-07-29T00:00:00+07:00");
const bkk31 = Date.parse("2026-07-31T00:00:00+07:00");

assert.equal(formatDateShort(bkk30), "30/7/26");
assert.equal(formatDateShort(utc30), "30/7/26");
assert.equal(bangkokDateKey(bkk30), "2026-07-30");
assert.equal(bangkokDateKey(utc30), "2026-07-30");

const pool = [
  { id: "utc30", date: utc30, createdAt: 1 },
  { id: "bkk29", date: bkk29, createdAt: 9 },
  { id: "bkk31", date: bkk31, createdAt: 2 },
  { id: "bkk30", date: bkk30, createdAt: 5 },
];
assert.deepEqual(
  sortByDateNewestFirst(pool).map((r) => r.id),
  ["bkk31", "bkk30", "utc30", "bkk29"],
);
assert.deepEqual(
  sortByDateNewestFirst(pool).map((r) => formatDateShort(r.date)),
  ["31/7/26", "30/7/26", "30/7/26", "29/7/26"],
);

console.log("OK test-ledger-date-newest-first");
