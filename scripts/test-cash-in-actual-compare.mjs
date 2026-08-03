/**
 * Gate: cash-in per-bill ได้จริง vs ยอดระบบ + ส่วน (document compare)
 * — keep tick checklist; preserve prior round-slip photos; Σ actual → transfer
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const panel = read("src/components/CashInLedgerPanel.tsx");
const css = read("src/app/globals.css");
const cash = read("src/lib/cash-deposits.ts");
const remit = read("src/lib/pos-session-remit.ts");
const doc = read("docs/npos-remit-rounds-phases.md");

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 668, `APP_BUILD >= 668, got ${buildMatch[1]}`);

assert.match(cash, /sessionActualAmounts/);
assert.match(cash, /normalizeSessionActualAmounts/);
assert.match(remit, /effectiveSessionCashAmount/);
assert.match(remit, /sessionCashCompareVariance/);
assert.match(remit, /sessionActualAmounts/);

assert.match(panel, /setSessionActualCash/);
assert.match(panel, /ได้จริง/);
assert.match(panel, /ส่วนต่าง/);
assert.match(panel, /cash-in-bill-compare/);
assert.match(panel, /cash-in-bill-sys-tag/);
assert.match(panel, /sessionActualAmounts/);
assert.match(panel, /toggleSessionTick/);
assert.match(panel, /cash-in-bill-main/);
assert.match(panel, /cash-in-bill-attach/);
assert.match(panel, /Keep prior round-slip photos|slipUrls: \[\.\.\.d\.slipUrls\]/);
assert.match(panel, /ไม่ใช่การโอน/);

assert.match(css, /\.cash-in-bill-compare\b/);
assert.match(css, /\.cash-in-bill-diff\.is-short\b/);
assert.match(css, /\.cash-in-bill-diff\.is-over\b/);
assert.match(css, /\.cash-in-bill-sys-tag\b/);

assert.match(doc, /R2\.11/);
assert.match(doc, /ได้จริง/);

console.log("OK test-cash-in-actual-compare");
