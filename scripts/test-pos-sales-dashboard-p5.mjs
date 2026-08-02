/**
 * Gate: POS sales dashboard phase 5 — stock card.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 625/);
assert.ok(existsSync(join(root, "src/components/PosSalesDashboardStock.tsx")));

const agg = read("src/lib/pos-sales-dashboard.ts");
assert.match(agg, /summarizeStockMovementsForDashboard/);
assert.match(agg, /filterStockMovementsInRange/);
assert.match(agg, /outAdjustCount|outAdjustValue/);

const stockUi = read("src/components/PosSalesDashboardStock.tsx");
assert.match(stockUi, /สินค้าคงคลัง/);
assert.match(stockUi, /มูลค่าเติมสินค้า/);
assert.match(stockUi, /มูลค่าเบิก\/ปรับ/);
assert.doesNotMatch(stockUi, /มูลค่าเสียหาย/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /PosSalesDashboardStock/);
assert.match(dash, /subscribeStockMovements/);
assert.match(dash, /stockCosts/);
assert.match(dash, /until:\s*clamped\.endMs|until: clamped.endMs/);
assert.match(dash, /posDateRangeDayCountRaw/);
assert.match(dash, /\/stock\//);

const stockLib = read("src/lib/stock.ts");
assert.match(stockLib, /until/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-dash-stock-split/);

const doc = read("docs/pos-sales-dashboard-phases.md");
assert.match(doc, /\[x\].*Query `stockMovements`/);
assert.match(doc, /\[x\].*เบิก\/ปรับ/);

console.log("OK test-pos-sales-dashboard-p5");
