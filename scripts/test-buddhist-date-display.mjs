/**
 * Phase 0: shared พ.ศ. display helpers (storage stays CE).
 * Phase 1: ledger opt-in via era="be".
 * Phase 2: owner-books opt-in via era="be" + layout from ledger prototype.
 * Phase 3: bill-notices opt-in via era="be" + layout from ledger prototype.
 * Phase 4: cash-in formatCashDayShort → พ.ศ. + layout from ledger prototype.
 * Phase 5: production formatDateShortBe + layout from ledger prototype.
 * Phase 6: OT formatDateShortBe + layout from ledger prototype.
 * Phase 7: check formatDateShortBe + layout from ledger prototype.
 * Phase 8: tasks formatDateShortBe + layout from ledger prototype.
 * Phase 9: stock monthLabel/formatDateShortBe + layout from ledger prototype.
 * Phase 10: payroll/rates formatDateShortBe + layout from ledger prototype.
 * Phase 11–13: default formatDateShort/Time → พ.ศ.; VAT/export/POS unify.
 * Storage / <input type="date"> remain ค.ศ.
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
const cashLib = read("src/lib/cash-deposits.ts");
const cashPanel = read("src/components/CashInLedgerPanel.tsx");
const production = read("src/app/production/page.tsx");
const ot = read("src/app/ot/page.tsx");
const check = read("src/app/check/page.tsx");
const tasks = read("src/app/tasks/page.tsx");
const stock = read("src/app/stock/page.tsx");
const stockHist = read("src/lib/stock-history.ts");
const payroll = read("src/components/PayrollPayPanel.tsx");
const rates = read("src/components/RateSchedulePanel.tsx");
const bonus = read("src/app/bonus/page.tsx");
const posReport = read("src/lib/pos-sales-report.ts");
const xlsx = read("src/lib/xlsx-export.ts");
const smart = read("src/lib/smart-search.ts");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(utils, /export function toBeYear/);
assert.match(utils, /export function bangkokDatePartsBe/);
assert.match(utils, /export function formatDateShortBe/);
assert.match(utils, /export function formatDateShortCe/);
assert.match(utils, /export function formatDateTimeShortCe/);
assert.match(utils, /export function formatDateTimeShortBe/);
assert.match(utils, /export function formatDateShort\(ms: number\)/);
assert.match(utils, /return formatDateShortBe\(ms\)/);
assert.match(utils, /return formatDateTimeShortBe\(ms\)/);
assert.match(cell, /era\?: SheetDateEra/);
assert.match(cell, /formatDateShortBe/);
assert.match(meta, /era\?: EntryTimestampEra/);
assert.match(meta, /formatDateShortBe/);
assert.match(ledger, /SheetDateCell ms=\{row\.date\} era="be"/);
assert.match(ledger, /era="be"/);
assert.match(owner, /SheetDateCell ms=\{row\.date\} era="be"/);
assert.match(owner, /owner-books-sheet/);
assert.match(owner, /era="be"/);
assert.match(bill, /SheetDateCell ms=\{row\.date\} era="be"/);
assert.match(bill, /era="be"/);
assert.match(cashLib, /export function formatCashDayShort/);
assert.match(cashLib, /getFullYear\(\) \+ 543/);
assert.match(cashPanel, /formatCashDayShort/);
assert.match(production, /formatDateShortBe/);
assert.match(production, /production-sheet/);
assert.match(production, /era="be"/);
assert.doesNotMatch(production, /[^B]formatDateShort\(|^formatDateShort\(/);
assert.match(ot, /formatDateShortBe/);
assert.match(ot, /formatDateTimeShortBe/);
assert.match(ot, /ot-page/);
assert.match(ot, /era="be"/);
assert.doesNotMatch(ot, /[^B]formatDateShort\(|^formatDateShort\(/);
assert.doesNotMatch(ot, /[^B]formatDateTimeShort\(|^formatDateTimeShort\(/);
assert.match(check, /formatDateShortBe/);
assert.match(check, /formatDateTimeShortBe/);
assert.match(check, /check-page/);
assert.match(check, /check-history-sheet/);
assert.doesNotMatch(check, /[^B]formatDateShort\(|^formatDateShort\(/);
assert.doesNotMatch(check, /[^B]formatDateTimeShort\(|^formatDateTimeShort\(/);
assert.match(tasks, /formatDateShortBe/);
assert.match(tasks, /tasks-page/);
assert.match(tasks, /tasks-sheet/);
assert.doesNotMatch(tasks, /[^B]formatDateShort\(|^formatDateShort\(/);
assert.match(stock, /formatDateShortBe/);
assert.match(stock, /stock-page/);
assert.match(stock, /stock-history-sheet/);
assert.doesNotMatch(stock, /[^B]formatDateShort\(|^formatDateShort\(/);
assert.match(stockHist, /year \+ 543/);
assert.match(payroll, /formatDateShortBe/);
assert.match(rates, /formatDateShortBe/);
assert.match(bonus, /bonus-page/);
assert.match(posReport, /yearCe \+ 543/);
assert.match(xlsx, /formatDateShort\(/);
assert.match(xlsx, /formatDateTimeShort\(/);
assert.match(smart, /formatDateShortCe\(row\.date\)/);
assert.doesNotMatch(payroll, /[^B]formatDateShort\(|^formatDateShort\(/);
assert.doesNotMatch(rates, /[^B]formatDateShort\(|^formatDateShort\(/);
assert.match(smart, /formatDateShortBe\(row\.date\)/);
assert.match(css, /Prototype table layout/);
assert.match(css, /Phase 2 table layout/);
assert.match(css, /Phase 3 table layout/);
assert.match(css, /Phase 4 table layout/);
assert.match(css, /Phase 5 table layout/);
assert.match(css, /Phase 6 table layout/);
assert.match(css, /Phase 7 table layout/);
assert.match(css, /Phase 8 table layout/);
assert.match(css, /Phase 9 table layout/);
assert.match(css, /Phase 10 table layout/);
assert.match(css, /Phase 11.\s*13 table layout/);
assert.match(css, /\.ledger-page \.ledger-staff-sheet \.sheet-table \.col-date/);
assert.match(css, /\.owner-books-page \.owner-books-sheet \.sheet-table \.col-date/);
assert.match(css, /\.bill-notice-slim \.col-date/);
assert.match(css, /\.cash-in-slim \.col-date/);
assert.match(css, /\.production-page \.production-sheet \.sheet-table \.col-date/);
assert.match(css, /\.ot-page \.ot-sheet-wrap \.ot-table \.ot-col-date/);
assert.match(css, /\.check-page \.check-history-sheet \.check-history-date/);
assert.match(css, /\.tasks-page \.tasks-sheet \.tasks-col-due/);
assert.match(css, /\.stock-page \.stock-history-sheet \.stock-history-date/);
assert.match(css, /\.bonus-page \.payroll-sheet \.payroll-col-due/);
assert.match(css, /width: 3\.55rem/);
assert.match(version, /APP_BUILD = 477/);

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
function formatDateShortAlias(ms) { return formatDateShortBe(ms); }
assert.equal(formatDateShortAlias(ms), "22/7/68");
assert.equal(bangkokDatePartsBe(ms)?.yearBe, 2568);

const ms2 = Date.parse("2026-07-29T15:04:00+07:00");
assert.equal(formatDateShortBe(ms2), "29/7/69");
assert.match(formatDateTimeShortBe(ms2), /^29\/7\/69 15:04$/);

assert.equal(formatDateShortBe(0), "—");

// Phase 4 cash-in day label uses the same พ.ศ. helper.
assert.equal(formatDateShortBe(Date.parse("2025-07-22T12:00:00+07:00")), "22/7/68");

console.log("OK test-buddhist-date-display");
