/**
 * Guard: ตารางเทียบเงินนำเข้า — collapsible panel on /ledger/ (no extra nav module)
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/cash-deposits.ts");
const panel = read("src/components/CashInLedgerPanel.tsx");
const ledger = read("src/app/ledger/page.tsx");
const redirect = read("src/app/ledger/cash-in/page.tsx");
const rules = read("firestore.rules");
const indexes = read("firestore.indexes.json");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");
const assertRules = read("scripts/assert-firestore-rules.mjs");

assert.match(version, /APP_BUILD = 377/);
assert.equal(existsSync(join(root, "src/components/LedgerModeSwitch.tsx")), false);
assert.match(ledger, /CashInLedgerPanel/);
assert.match(ledger, /cashInForceOpen|cashIn=1/);
assert.doesNotMatch(ledger, /LedgerModeSwitch/);
assert.match(redirect, /ledger\/\?cashIn=1/);
assert.match(panel, /export function CashInLedgerPanel/);
assert.match(panel, /telltea_cash_in_panel_open_v1/);
assert.match(panel, /addCashDeposit/);
assert.match(panel, /verifyCashDeposit/);
assert.match(panel, /สลิปสรุป POS|รูปสลิป POS/);
assert.match(panel, /ยอดโอนธนาคาร/);
assert.match(panel, /CASH_DEPOSIT_ROUND_PRESETS/);
assert.match(lib, /export async function addCashDeposit/);
assert.match(lib, /CASH_DEPOSIT_DAY_MAX = 31/);
assert.match(lib, /analyzeCashDepositDays/);
assert.match(lib, /orderBy\("createdAt", "desc"\)/);
assert.doesNotMatch(
  lib,
  /orderBy\("transferDate", "desc"\)[\s\S]*orderBy\("createdAt", "desc"\)/,
);
assert.match(rules, /match \/cashDeposits\/\{entryId\}/);
assert.match(rules, /days\.size\(\) <= 31/);
assert.match(indexes, /"collectionGroup": "cashDeposits"/);
assert.match(assertRules, /"cashDeposits"/);
assert.match(css, /\.cash-in-panel\b/);
assert.match(css, /\.cash-in-panel-toggle\b/);
assert.match(css, /\.cash-in-issues\b/);

function sumCashDepositDays(days) {
  return days.reduce((sum, d) => sum + (Number(d.cashAmount) || 0), 0);
}
function cashDepositVariance(bankAmount, expectedCashTotal) {
  return Math.round((Number(bankAmount) - Number(expectedCashTotal)) * 100) / 100;
}
assert.equal(sumCashDepositDays([{ cashAmount: 100 }, { cashAmount: 50.5 }]), 150.5);
assert.equal(cashDepositVariance(13435, 13435), 0);
assert.equal(cashDepositVariance(13435, 13400), 35);

console.log("OK test-cash-in-ledger");
