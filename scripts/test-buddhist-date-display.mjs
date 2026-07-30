/**
 * Phase 0: shared พ.ศ. display helpers (storage stays CE).
 * Phase 1: ledger opt-in via era="be" — other tables keep default ค.ศ.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const utils = read("src/lib/utils.ts");
const cell = read("src/components/SheetDateCell.tsx");
const meta = read("src/components/EntryTimestampsMeta.tsx");
const ledger = read("src/app/ledger/page.tsx");
const owner = read("src/app/owner-books/page.tsx");
const bill = read("src/components/BillNoticeLedgerPanel.tsx");
const smart = read("src/lib/smart-search.ts");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(utils, /export function toBeYear/);
assert.match(utils, /export function bangkokDatePartsBe/);
assert.match(utils, /export function formatDateShortBe/);
assert.match(utils, /export function formatDateTimeShortBe/);
assert.match(cell, /era\?: SheetDateEra/);
assert.match(cell, /formatDateShortBe/);
assert.match(meta, /era\?: EntryTimestampEra/);
assert.match(meta, /formatDateShortBe/);
assert.match(ledger, /SheetDateCell ms=\{row\.date\} era="be"/);
assert.match(ledger, /era="be"/);
assert.doesNotMatch(owner, /SheetDateCell[^>]*era="be"/);
assert.doesNotMatch(bill, /SheetDateCell[^>]*era="be"/);
assert.match(smart, /formatDateShortBe\(row\.date\)/);
assert.match(css, /Prototype table layout/);
assert.match(css, /\.ledger-page \.ledger-staff-sheet \.sheet-table \.col-date/);
assert.match(css, /width: 3\.55rem/);
assert.match(version, /APP_BUILD = 467/);

function bangkokDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function toBeYear(ceYear) {
  if (!Number.isFinite(ceYear)) return null;
  if (ceYear < 1900 || ceYear > 2100) return null;
  return ceYear + 543;
}

function bangkokDatePartsBe(ms) {
  if (!ms) return null;
  const key = bangkokDateKey(ms);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [ys, msPart, ds] = key.split("-").map(Number);
  const yearBe = toBeYear(ys);
  if (yearBe == null || !msPart || !ds) return null;
  return { day: ds, month: msPart, yearBe, year2: String(yearBe).slice(-2) };
}

function formatDateShortBe(ms) {
  const p = bangkokDatePartsBe(ms);
  if (!p) return "—";
  return `${p.day}/${p.month}/${p.year2}`;
}

function formatDateTimeShortBe(ms) {
  if (!ms) return "—";
  const p = bangkokDatePartsBe(ms);
  if (!p) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((x) => x.type === t)?.value || "";
  return `${p.day}/${p.month}/${p.year2} ${String(get("hour")).padStart(2, "0")}:${String(get("minute")).padStart(2, "0")}`;
}

assert.equal(toBeYear(2025), 2568);
assert.equal(toBeYear(2026), 2569);
assert.equal(toBeYear(2568), null);

const ms = Date.parse("2025-07-22T12:00:00+07:00");
assert.equal(formatDateShortBe(ms), "22/7/68");
assert.equal(bangkokDatePartsBe(ms)?.yearBe, 2568);

const ms2 = Date.parse("2026-07-29T15:04:00+07:00");
assert.equal(formatDateShortBe(ms2), "29/7/69");
assert.match(formatDateTimeShortBe(ms2), /^29\/7\/69 15:04$/);

assert.equal(formatDateShortBe(0), "—");

console.log("OK test-buddhist-date-display");
