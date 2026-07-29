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

assert.match(version, /APP_BUILD = 387/);
assert.equal(existsSync(join(root, "src/components/LedgerModeSwitch.tsx")), false);
assert.match(ledger, /CashInLedgerPanel/);
assert.match(ledger, /cashInForceOpen|cashIn=1/);
assert.match(redirect, /ledger\/\?cashIn=1/);
assert.match(panel, /export function CashInLedgerPanel/);
assert.match(panel, /สร้างรอบ/);
assert.match(panel, /cash-in-slim/);
assert.match(panel, /cash-in-bank-table/);
assert.match(panel, /\+ สลิปโอน/);
assert.match(panel, /โอนเข้า/);
assert.match(panel, /เงินสด/);
assert.match(panel, /ค่าธรรมเนียม|ค่าธรรม\./);
assert.match(panel, /remainingToTransfer|cash-in-remain/);
assert.match(panel, /คงเหลือ/);
assert.match(panel, /ร้านปิดใส่/);
assert.doesNotMatch(panel, /ปิดลิ้นชัก/);
assert.doesNotMatch(panel, /เข้าบช\.สุทธิ/);
assert.doesNotMatch(panel, /คชจ\./);
assert.match(panel, /startCreateRound/);
assert.doesNotMatch(panel, /CashDepositFormModal/);
assert.doesNotMatch(panel, /modal-backdrop edit-modal/);
assert.match(lib, /export async function addCashDeposit/);
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
assert.match(css, /\.cash-in-cell-inline\b/);
assert.match(css, /\.cash-in-act-btn\b/);
assert.match(panel, /cash-in-slip-actions is-row/);
assert.match(panel, /"บันทึก"/);
assert.doesNotMatch(panel, /Σยอดขายเงินสด/);

console.log("OK test-cash-in-ledger");
