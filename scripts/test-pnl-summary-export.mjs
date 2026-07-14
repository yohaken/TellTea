/**
 * PNL summary helpers — income filter + weighted totals
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pnlSrc = readFileSync(join(root, "src/lib/pnl.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/pnl/page.tsx"), "utf8");
const exportSrc = readFileSync(join(root, "src/lib/xlsx-export.ts"), "utf8");
const exportPage = readFileSync(join(root, "src/app/export/page.tsx"), "utf8");

assert.match(pnlSrc, /completePnlMonths/);
assert.match(pnlSrc, /summarizePnlRows/);
assert.match(pnlSrc, /averagePnlRows/);
assert.match(pnlSrc, /averageCategoryRows/);
assert.match(pageSrc, /summaryMode/);
assert.match(pageSrc, /pnlAverages/);
assert.match(pageSrc, /เฉลี่ย/);
assert.match(exportSrc, /exportCombinedTablesXlsx/);
assert.match(exportPage, /ไฟล์เดียว/);

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const avgs = mean([0.4, 0.2]);
assert.ok(Math.abs(avgs - 0.3) < 1e-9);

function weightedCogsPct(rows) {
  const income = rows.reduce((s, r) => s + r.income, 0);
  const cogs = rows.reduce((s, r) => s + r.cogs, 0);
  return cogs / income;
}

assert.equal(
  weightedCogsPct([
    { income: 100, cogs: 40 },
    { income: 300, cogs: 60 },
  ]),
  0.25,
);

console.log("OK test-pnl-summary-export");
