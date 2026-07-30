/**
 * Guard: stock history — full พ.ศ. dates, auto 3 rounds ahead,
 * newest→oldest sort, no free-form "+ นับสต็อก" create.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const histSrc = read("src/lib/stock-history.ts");
const stockPage = read("src/app/stock/page.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD\s*=\s*483/);
assert.match(histSrc, /export function stockRoundDateLabelBe/);
assert.match(histSrc, /export function upcomingStockRounds/);
assert.match(histSrc, /upcomingStockRounds\(3/);
assert.match(histSrc, /Always newest → oldest|newest → oldest/i);
assert.match(histSrc, /b\.dateMs - a\.dateMs/);
assert.match(
  histSrc,
  /monthLabel:\s*stockRoundDateLabelBe\(year,\s*month,\s*dayOfMonth\)/,
);
assert.doesNotMatch(histSrc, /return `\$\{row\.monthLabel\} · \$\{row\.dayOfMonth\}`/);
assert.doesNotMatch(histSrc, /day <= todayDay/);

assert.match(stockPage, /lockedRound/);
assert.match(stockPage, /onCountRound/);
assert.match(stockPage, /ยังไม่นับ · แตะกรอก/);
assert.doesNotMatch(stockPage, /ModuleTabDock/);
assert.doesNotMatch(stockPage, /\+ นับสต็อก/);
assert.doesNotMatch(stockPage, /type="month"/);
assert.doesNotMatch(stockPage, /STOCK_COUNT_ROUNDS\.map/);

assert.match(css, /Phone: stack|grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.match(css, /\.stock-history-round-btn/);

/** Mirror stockRoundDateLabelBe */
function stockRoundDateLabelBe(year, month, dayOfMonth) {
  return `${dayOfMonth}/${month + 1}/${String(year + 543).slice(-2)}`;
}
assert.equal(stockRoundDateLabelBe(2026, 6, 20), "20/7/69");

console.log("OK test-stock-history-round-label");
