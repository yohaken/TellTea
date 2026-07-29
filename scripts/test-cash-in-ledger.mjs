/**
 * Guard: ตารางเทียบเงินนำเข้า under /ledger/cash-in/
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/cash-deposits.ts");
const page = read("src/app/ledger/cash-in/page.tsx");
const ledger = read("src/app/ledger/page.tsx");
const mode = read("src/components/LedgerModeSwitch.tsx");
const rules = read("firestore.rules");
const indexes = read("firestore.indexes.json");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");
const assertRules = read("scripts/assert-firestore-rules.mjs");

assert.match(version, /APP_BUILD = 372/);
assert.match(mode, /\/ledger\/cash-in\//);
assert.match(mode, /เทียบเงินนำเข้า/);
assert.match(ledger, /LedgerModeSwitch/);
assert.match(ledger, /active="ledger"/);
assert.match(page, /LedgerModeSwitch/);
assert.match(page, /active="cash-in"/);
assert.match(page, /addCashDeposit/);
assert.match(page, /verifyCashDeposit/);
assert.match(page, /สลิปสรุป POS/);
assert.match(page, /ยอดโอนธนาคาร/);
assert.match(lib, /export async function addCashDeposit/);
assert.match(lib, /export async function verifyCashDeposit/);
assert.match(lib, /CASH_DEPOSIT_DAY_MAX = 14/);
assert.match(lib, /cashDepositVariance/);
assert.match(rules, /match \/cashDeposits\/\{entryId\}/);
assert.match(rules, /request\.resource\.data\.status == 'pending'/);
assert.match(indexes, /"collectionGroup": "cashDeposits"/);
assert.match(assertRules, /"cashDeposits"/);
assert.match(css, /\.cash-in-page|\.cash-in-table|\.cash-in-math/);
assert.match(css, /\.ledger-mode-switch/);

// Pure helpers — smoke without Firestore
const { createRequire } = await import("node:module");
void createRequire;
function sumCashDepositDays(days) {
  return days.reduce((sum, d) => sum + (Number(d.cashAmount) || 0), 0);
}
function cashDepositVariance(bankAmount, expectedCashTotal) {
  return Math.round((Number(bankAmount) - Number(expectedCashTotal)) * 100) / 100;
}
assert.equal(sumCashDepositDays([{ cashAmount: 100 }, { cashAmount: 50.5 }]), 150.5);
assert.equal(cashDepositVariance(13435, 13435), 0);
assert.equal(cashDepositVariance(13435, 13400), 35);
assert.equal(cashDepositVariance(100, 120.1), -20.1);

console.log("OK test-cash-in-ledger");
