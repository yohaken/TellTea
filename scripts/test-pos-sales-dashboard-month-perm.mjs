/**
 * Gate: dashboard month picker + permission hardening around date row.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 629/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 169/);

const lib = read("src/lib/pos-sales-report.ts");
assert.match(lib, /posDashboardMonthRange/);
assert.match(lib, /listPosDashboardMonthOptions/);
assert.match(lib, /posRangeMatchedMonthKey/);
assert.match(lib, /shiftPosMonthKey/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /pos-dash-month-nav|pos-dash-month-select/);
assert.match(dash, /selectMonth|shiftMonth/);
assert.match(dash, /stockNote/);
assert.match(dash, /since:\s*clamped\.startMs/);
assert.doesNotMatch(dash, /until:\s*clamped\.endMs/);
assert.match(dash, /ไม่มีสิทธิ์อ่านยอดขาย|permission|insufficient/i);

const rules = read("firestore.rules");
assert.match(
  rules,
  /match \/posSales\/\{id\}[\s\S]*?allow read: if isOwner\(\) \|\| isOwnerEmail\(\)/,
);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-dash-month-nav/);
assert.match(css, /\.pos-dash-month-select/);

console.log("OK test-pos-sales-dashboard-month-perm");
