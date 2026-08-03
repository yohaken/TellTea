/**
 * Gate: cash-in helpers for actual/session maps remain in lib (data compat)
 * UI no longer exposes ได้จริง / ใบรอบ — focus is bank transfer variance.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const panel = read("src/components/CashInLedgerPanel.tsx");
const cash = read("src/lib/cash-deposits.ts");
const remit = read("src/lib/pos-session-remit.ts");
const doc = read("docs/npos-remit-rounds-phases.md");

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 674, `APP_BUILD >= 674, got ${buildMatch[1]}`);

assert.match(cash, /sessionActualAmounts/);
assert.match(cash, /normalizeSessionActualAmounts/);
assert.match(remit, /effectiveSessionCashAmount/);
assert.match(remit, /sessionCashCompareVariance/);

assert.match(panel, /toggleSessionTick/);
assert.match(panel, /ควรเข้าบัญชี/);
assert.match(panel, /ส่วนต่าง/);
assert.match(panel, /deriveCashDepositTransferUiState|รอสลิปโอน/);
assert.doesNotMatch(panel, /setSessionActualCash/);
assert.doesNotMatch(panel, /attachPosPrintForSession/);
assert.doesNotMatch(panel, /ได้จริง/);

assert.match(doc, /R2\.14/);

console.log("OK test-cash-in-actual-compare");
