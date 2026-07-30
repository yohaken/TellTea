/**
 * Guard: stock history round labels use full พ.ศ. dates (D/M/YY),
 * keep empty plan-ahead rows (all 1·10·20), past uncounted stay visible.
 *
 * Source-level + pure label formula (no firebase import).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const histSrc = read("src/lib/stock-history.ts");
const stockPage = read("src/app/stock/page.tsx");
const version = read("src/lib/version.ts");
const utils = read("src/lib/utils.ts");

assert.match(version, /APP_BUILD\s*=\s*482/);
assert.match(histSrc, /export function stockRoundDateLabelBe/);
assert.match(histSrc, /toBeYear/);
assert.match(histSrc, /plan-ahead/);
assert.match(histSrc, /return STOCK_COUNT_ROUNDS/);
assert.match(
  histSrc,
  /monthLabel:\s*stockRoundDateLabelBe\(year,\s*month,\s*dayOfMonth\)/,
);
assert.match(
  histSrc,
  /return row\.monthLabel \|\| stockRoundDateLabelBe\(row\.year,\s*row\.month,\s*row\.dayOfMonth\)/,
);
assert.doesNotMatch(histSrc, /monthLabel: `\$\{month \+ 1\}\/\$\{String\(year \+ 543\)/);
assert.doesNotMatch(histSrc, /return `\$\{row\.monthLabel\} · \$\{row\.dayOfMonth\}`/);
assert.doesNotMatch(histSrc, /day <= todayDay/);
assert.doesNotMatch(histSrc, /isCurrentMonth/);

assert.match(stockPage, /timelineRoundLabel\(row\)/);
assert.doesNotMatch(
  stockPage,
  /timelineRoundLabel\(row\)\s*·\s*\{formatDateShortBe\(row\.dateMs\)\}/,
);
assert.doesNotMatch(stockPage, /formatDateShortBe/);

assert.match(utils, /export function toBeYear/);

/** Mirror stockRoundDateLabelBe — must stay in sync with stock-history.ts */
function stockRoundDateLabelBe(year, month, dayOfMonth) {
  const yearBe = year + 543;
  return `${dayOfMonth}/${month + 1}/${String(yearBe).slice(-2)}`;
}

assert.equal(stockRoundDateLabelBe(2026, 6, 20), "20/7/69");
assert.equal(stockRoundDateLabelBe(2026, 0, 1), "1/1/69");
assert.equal(stockRoundDateLabelBe(2025, 11, 10), "10/12/68");
assert.ok(!stockRoundDateLabelBe(2026, 6, 20).includes(" · "));
assert.equal(stockRoundDateLabelBe(2026, 6, 20).split("/").length, 3);

// Implementation body must compose day/month/BE-year2 the same way
assert.match(
  histSrc,
  /\$\{dayOfMonth\}\/\$\{month \+ 1\}\/\$\{String\(yearBe\)\.slice\(-2\)\}/,
);

console.log("OK test-stock-history-round-label");
