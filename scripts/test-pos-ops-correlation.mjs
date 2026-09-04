/**
 * Gate: POS ops correlation chart (sales × brew × prod) on /pos-sales dashboard.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(
  Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 879,
);
assert.ok(
  Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)?.[1] || 0) >= 221,
);

const report = read("src/lib/pos-sales-report.ts");
assert.match(report, /POS_DASHBOARD_MAX_RANGE_DAYS = 366/);

const lib = read("src/lib/pos-ops-correlation.ts");
assert.match(lib, /summarizeOpsCorrelationByDay/);
assert.match(lib, /enumeratePosRangeDays/);
assert.match(lib, /storefrontSales/);
assert.match(lib, /brewQty/);
assert.match(lib, /brewBonus/);
assert.match(lib, /prodQty/);
assert.match(lib, /prodBonus/);
assert.match(lib, /byShift/);
assert.match(lib, /OPS_SHIFT_SERIES/);
assert.match(lib, /addLocalDays/);
assert.match(lib, /computeOtBonus/);
assert.match(lib, /computeProdBonus/);
assert.match(lib, /POS_OPS_CORR_PREFS_KEY/);
assert.match(lib, /loadPosOpsCorrPrefs/);
assert.match(lib, /savePosOpsCorrPrefs/);
assert.match(lib, /normalizePosOpsCorrVisible/);
assert.match(lib, /scaleMode/);

const chart = read("src/components/PosOpsCorrelationChart.tsx");
assert.match(chart, /PosOpsCorrelationChart/);
assert.match(chart, /ยอดหน้าร้าน/);
assert.match(chart, /โบนัสชงรวม/);
assert.match(chart, /หน่วยชง/);
assert.match(chart, /ชิ้นผลิต/);
assert.match(chart, /โบนัสผลิต/);
assert.match(chart, /pos-ops-line--sales/);
assert.match(chart, /pos-ops-legend-btn/);
assert.match(chart, /pos-ops-corr-tooltip/);
assert.match(chart, /formatAxisNumber/);
assert.match(chart, /aria-pressed/);
assert.match(chart, /loadPosOpsCorrPrefs/);
assert.match(chart, /savePosOpsCorrPrefs/);
assert.match(chart, /จำอัตโนมัติ/);
assert.match(lib, /pos-ops-line--morning/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /PosOpsCorrelationChart/);
assert.match(dash, /!rangeTooLong \? <PosOpsCorrelationChart/);
assert.match(dash, /summarizeOpsCorrelationByDay/);
assert.match(dash, /subscribeOtEntries/);
assert.match(dash, /subscribeProdEntries/);
assert.match(dash, /subscribeProdPolicy/);
assert.match(dash, /last3m/);
assert.match(dash, /last6m/);
assert.match(dash, /last1y/);
assert.match(dash, /3 เดือน/);
assert.match(dash, /6 เดือน/);
assert.match(dash, /1 ปี/);
assert.match(dash, /opsPoints/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-ops-corr-card/);
assert.match(css, /\.pos-ops-line--sales/);
assert.match(css, /\.pos-ops-line--morning/);
assert.match(css, /\.pos-ops-swatch--prod-bonus/);
assert.match(css, /\.pos-ops-legend-btn/);
assert.match(css, /\.pos-ops-corr-tooltip/);
assert.match(css, /\.pos-ops-corr-axis-y/);

console.log("OK test-pos-ops-correlation");
