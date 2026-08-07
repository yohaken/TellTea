/**
 * Guard: members P3 — dashboard redeem + points earned/cut.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const report = read("src/lib/pos-sales-report.ts");
assert.match(report, /manualDiscountTotal/);
assert.match(report, /redeemTotal/);
assert.match(report, /redeemBillCount/);
assert.match(report, /pointsRedeemedTotal/);
assert.match(report, /pointsEarnedTotal/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /แลกแต้ม/);
assert.match(dash, /แต้มสมาชิก/);
assert.match(dash, /pointsEarnedTotal/);
assert.match(dash, /pointsRedeemedTotal/);
assert.match(dash, /manualDiscountTotal/);

const sessions = read("src/components/PosSalesReport.tsx");
assert.match(sessions, /redeemTotal/);
assert.match(sessions, /manualDiscountTotal/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 738);

console.log("OK test-members-p3-dashboard");
