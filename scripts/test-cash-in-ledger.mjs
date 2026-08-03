/**
 * Guard: ตารางเทียบเงินนำเข้า — compact slim table on /ledger/ (no popup form)
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

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 653, `APP_BUILD >= 653, got ${buildMatch[1]}`);
assert.equal(existsSync(join(root, "src/components/LedgerModeSwitch.tsx")), false);
assert.match(ledger, /CashInLedgerPanel/);
assert.match(ledger, /ledger-ops-duo/);
assert.match(ledger, /cashInForceOpen|cashIn=1/);
assert.match(redirect, /ledger\/\?cashIn=1/);
assert.match(panel, /export function CashInLedgerPanel/);
assert.match(panel, /is-tap|queueSessionIntoWorking/);
assert.match(panel, /โอนนำเข้า|ในมัด/);
assert.match(panel, /cash-in-slim/);
assert.match(panel, /cash-in-bank-table/);
assert.match(panel, /\+สลิป/);
assert.match(panel, /เข้าบช\./);
assert.match(panel, /remainingToTransfer|cash-in-remain/);
assert.match(panel, /assertCashDepositDaysNposLinked/);
assert.match(panel, /fillNetBankFromBundle|queueAllPendingIntoWorking/);
assert.match(panel, /suggestedNetBankTransfer|netBankTarget/);
assert.match(panel, /cash-in-compact-btn/);
assert.match(lib, /suggestedNetBankTransfer/);
assert.match(lib, /allowGaps/);
assert.doesNotMatch(panel, /runAiDay|extractCashDaySlipFromPhotos/);
assert.doesNotMatch(panel, /ปิดลิ้นชัก/);
assert.doesNotMatch(panel, /\+รอบ|cash-in-create-bar/);
assert.doesNotMatch(panel, /\+ วันก่อนหน้า/);
assert.doesNotMatch(panel, /CashDepositFormModal/);
assert.doesNotMatch(panel, /modal-backdrop edit-modal/);
assert.match(lib, /export async function addCashDeposit/);
assert.match(lib, /export function assertCashDepositDaysNposLinked/);
assert.match(lib, /CASH_DEPOSIT_DAY_MAX = 31/);
assert.match(lib, /CASH_DEPOSIT_BANK_TRANSFER_MAX/);
assert.match(lib, /bankTransfers/);
assert.match(lib, /drawerCloseAmount/);
assert.match(lib, /labelCashDepositRound/);
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
assert.match(css, /\.cash-in-slim\b/);
assert.match(css, /\.cash-in-create-bar\b/);
assert.match(css, /\.cash-in-bank-table\b/);
assert.match(css, /\.cash-in-remain\b/);
assert.match(css, /Phase 4 table layout/);
assert.match(css, /\.cash-in-slim \.col-date/);
assert.match(css, /width: 3\.55rem/);
assert.match(css, /\.ledger-ops-duo\b/);
assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
assert.match(css, /Phone: stack/);
assert.match(lib, /export function formatCashDayShort/);
assert.match(lib, /getFullYear\(\) \+ 543/);

console.log("OK test-cash-in-ledger");
