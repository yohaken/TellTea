/**
 * Guard: AI cash-deposit slip OCR (bank + day) + multi bank-transfer fees + fill source
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const cf = read("functions/extract-cash-deposit.js");
const index = read("functions/index.js");
const client = read("src/lib/cash-deposits-ai.ts");
const lib = read("src/lib/cash-deposits.ts");
const panel = read("src/components/CashInLedgerPanel.tsx");
const version = read("src/lib/version.ts");

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 651, `APP_BUILD >= 651, got ${buildMatch[1]}`);
assert.ok(existsSync(join(root, "functions/extract-cash-deposit.js")));
assert.match(index, /extractCashDepositSlip/);
assert.match(cf, /mode === "bank"/);
assert.match(cf, /BANK_SYSTEM_PROMPT|สลิปโอนเงิน/);
assert.match(cf, /DAY_SYSTEM_PROMPT|เงินสด/);
assert.match(cf, /ยอดขายตามการชำระเงิน|Expected Cash/);
assert.match(cf, /drawerCloseAmount เป็น null/);
assert.match(cf, /transferFee/);
assert.match(cf, /สลิปโอนหนึ่งใบ|อย่ารวมยอดจากสลิปอื่น/);
assert.match(client, /extractCashBankSlipFromPhotos/);
assert.match(client, /extractCashDaySlipFromPhotos/);
assert.match(lib, /transferFee/);
assert.match(lib, /CashDepositBankTransfer/);
assert.match(lib, /bankTransfers/);
assert.match(lib, /sumBankTransferFees/);
assert.match(lib, /coerceBankTransfers/);
assert.match(lib, /CashFillSource/);
assert.match(lib, /bankAmountSource/);
assert.match(lib, /cashAmountSource/);
assert.match(panel, /runAiBank/);
assert.doesNotMatch(panel, /runAiDay|extractCashDaySlipFromPhotos/);
assert.match(panel, /เข้าบช\.สุทธิ/);
assert.match(panel, /คงเหลือ|remainingToTransfer/);
assert.match(panel, /คชจ\.|transferFee|workingFee/);
assert.match(panel, /ใส่โดยพนักงาน|is-staff|cash-in-src/);
assert.match(panel, /อ่าน AI ใหม่|ให้อ่านสลิปโอนใหม่/);
assert.match(panel, /\+ สลิปโอน/);
assert.match(panel, /cash-in-bank-table/);
assert.match(panel, /addBankTransfer/);
assert.match(panel, /evidence only|ยอดบิลนำส่งกด/);
assert.match(client, /extractCashDaySlipFromPhotos/);

const runner = `
import assert from "node:assert/strict";
import {
  cashDepositVariance,
  coerceBankTransfers,
  sumBankTransferAmounts,
  sumBankTransferFees,
  emptyCashDepositBankTransfer,
} from "../src/lib/cash-deposits.ts";

assert.equal(cashDepositVariance(10000, 10000, 0), 0);
assert.equal(cashDepositVariance(9950, 10000, 50), 0);
assert.equal(cashDepositVariance(10000, 10000, 50), 50);
assert.equal(cashDepositVariance(9900, 10000, 0), -100);

const two = [
  { ...emptyCashDepositBankTransfer(), amount: 5000, fee: 10 },
  { ...emptyCashDepositBankTransfer(), amount: 4950, fee: 15 },
];
assert.equal(sumBankTransferAmounts(two), 9950);
assert.equal(sumBankTransferFees(two), 25);
assert.equal(cashDepositVariance(9950, 9975, 25), 0);

const legacy = coerceBankTransfers({
  bankAmount: 8000,
  transferFee: 20,
  bankSlipUrls: ["https://example.com/a.jpg"],
  bankRef: "REF1",
});
assert.equal(legacy.length, 1);
assert.equal(legacy[0].amount, 8000);
assert.equal(legacy[0].fee, 20);

const fromList = coerceBankTransfers({
  bankTransfers: two,
  bankAmount: 1,
  transferFee: 999,
});
assert.equal(fromList.length, 2);
assert.equal(sumBankTransferFees(fromList), 25);

console.log("OK fee reconcile + multi bankTransfers");
`;
const tmp = join(root, "scripts/.tmp-cash-ai-run.mts");
writeFileSync(tmp, runner);
const res = spawnSync("npx", ["--yes", "tsx", tmp], { cwd: root, encoding: "utf8" });
try {
  unlinkSync(tmp);
} catch {
  /* ignore */
}
if (res.status !== 0) {
  console.error(res.stdout, res.stderr);
  process.exit(res.status || 1);
}
process.stdout.write(res.stdout);
console.log("OK test-cash-deposit-ai");
