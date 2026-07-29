/**
 * Guard: live pages must scope Firestore loads (ไม่ดึงประวัติทั้งก้อน).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
assert.match(version, /APP_BUILD = 415/);

const qw = read("src/lib/query-window.ts");
assert.match(qw, /export function daysAgoMs/);
assert.match(qw, /export function localMonthRangeMs/);
assert.match(qw, /export function monthsAgoStartMs/);

// Libs expose window opts
assert.match(read("src/lib/production.ts"), /PROD_HISTORY_LOOKBACK_DAYS = 60/);
assert.match(read("src/lib/production.ts"), /opts\?: \{ since\?: number; until\?: number \}/);
assert.match(read("src/lib/task-occurrences.ts"), /TASK_OCCURRENCE_LOOKBACK_DAYS = 120/);
assert.match(read("src/lib/task-occurrences.ts"), /where\("dueDate", ">=", since\)/);
assert.match(read("src/lib/stock-count.ts"), /STOCK_COUNT_LOOKBACK_DAYS = 400/);
assert.match(read("src/lib/payroll.ts"), /opts\?: \{ since\?: number \}/);
assert.match(read("src/lib/ot.ts"), /until\?: number/);
assert.match(read("src/lib/checklist.ts"), /until\?: number/);
assert.match(read("src/lib/owner-books.ts"), /listOwnerBookEntriesInMonth/);
assert.match(read("src/lib/owner-books.ts"), /listOwnerBookEntriesSince/);
assert.match(read("src/lib/owner-books.ts"), /listRecentOwnerBookEntries/);
assert.match(read("src/lib/ledger.ts"), /listLedgerEntriesSince/);
assert.match(read("src/lib/pnl.ts"), /PNL_LOOKBACK_MONTHS = 18/);
assert.match(read("src/lib/pnl.ts"), /listLedgerEntriesSince/);
assert.match(read("src/lib/books-vat-month.ts"), /listOwnerBookEntriesInMonth/);

// Pages wire scoped subscribe / queries
const check = read("src/app/check/page.tsx");
assert.match(check, /historyMonth/);
assert.match(check, /\{ since, until \}/);

const prod = read("src/app/production/page.tsx");
assert.match(prod, /prodHistorySinceMs/);
assert.match(prod, /logMonth/);
assert.match(prod, /until: new Date\(logYear, logMonthIdx \+ 1, 1\)\.getTime\(\)/);

const bonus = read("src/app/bonus/page.tsx");
assert.match(bonus, /until: monthUntil/);
assert.match(bonus, /subscribeProdEntries\([\s\S]*\{ since: monthSince, until: monthUntil \}/);
assert.match(bonus, /since: payrollSince/);

const tasks = read("src/app/tasks/page.tsx");
assert.match(tasks, /taskOccurrenceSinceMs\(\)/);

const stock = read("src/app/stock/page.tsx");
assert.match(stock, /stockCountSinceMs\(\)/);

const ledger = read("src/app/ledger/page.tsx");
assert.match(ledger, /listLedgerEntriesSince\(daysAgoMs\(180\)\)/);
assert.doesNotMatch(ledger, /void listLedgerEntries\(\)/);

const owner = read("src/app/owner-books/page.tsx");
assert.match(owner, /listOwnerBookEntriesSince\(daysAgoMs\(180\)\)/);
assert.match(owner, /listRecentOwnerBookEntries\(200\)/);

const dock = read("src/components/StaffUtilityDock.tsx");
assert.match(dock, /taskOccurrenceSinceMs\(\)/);
const panel = read("src/components/StaffUtilityPanel.tsx");
assert.match(panel, /taskOccurrenceSinceMs\(\)/);

// Pure helper smoke
function daysAgoMs(days, now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - Math.max(1, Math.floor(days)));
  return d.getTime();
}
const noon = new Date(2026, 6, 29, 12).getTime();
assert.equal(daysAgoMs(60, noon), new Date(2026, 4, 30).getTime());

console.log("OK test-scoped-firestore-loads");
