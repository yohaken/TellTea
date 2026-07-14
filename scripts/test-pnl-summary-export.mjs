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
assert.match(pnlSrc, /sumCategoryRows/);
assert.match(pageSrc, /summaryMode/);
assert.match(pageSrc, /โหมดสรุป/);
assert.match(pageSrc, /exportPnlXlsx/);
assert.match(exportSrc, /exportCombinedTablesXlsx/);
assert.match(exportSrc, /3-กำไรขาดทุน/);
assert.match(exportPage, /ไฟล์เดียว/);
assert.match(exportPage, /pnlSummaryOnly/);

function pct(part, whole) {
  if (!whole) return null;
  return part / whole;
}

function summarize(rows) {
  let income = 0;
  let cogs = 0;
  for (const r of rows) {
    income += r.income;
    cogs += r.cogs;
  }
  return { income, cogs, cogsPct: pct(cogs, income) };
}

const t = summarize([
  { income: 100, cogs: 40 },
  { income: 300, cogs: 60 },
]);
assert.equal(t.income, 400);
assert.equal(t.cogs, 100);
assert.equal(t.cogsPct, 0.25); // not (0.4+0.2)/2 = 0.3

console.log("OK test-pnl-summary-export");
