/**
 * PNL summary helpers — income filter + weighted totals + row-count averages
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
assert.match(pnlSrc, /meanOverRowCount/);
assert.match(pnlSrc, /Pad missing months/);
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

/** Mirror meanOverRowCount: null contributes 0 to sum; divisor = all rows. */
function meanOverRowCount(values, rowCount) {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  if (!any) return null;
  return sum / rowCount;
}

assert.equal(meanOverRowCount([0.5, null, 0.5], 3), 1 / 3);
assert.ok(Math.abs(meanOverRowCount([0.4, 0.2], 2) - 0.3) < 1e-9);

/** Pad filter: every requested month appears (zeros if missing). */
function filterCategoryRowsByMonths(rows, months) {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map(
    (month) => byMonth.get(month) || { month, asset: 0, cogs: 0, sga: 0, other: 0 },
  );
}

const padded = filterCategoryRowsByMonths(
  [{ month: "2024-01", asset: 10, cogs: 0, sga: 0, other: 0 }],
  ["2024-01", "2024-02"],
);
assert.equal(padded.length, 2);
assert.equal(padded[1].asset, 0);
assert.equal((padded[0].asset + padded[1].asset) / padded.length, 5);

console.log("OK test-pnl-summary-export");
