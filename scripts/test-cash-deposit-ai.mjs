/**
 * Guard: AI cash-deposit slip OCR (bank + day) + fee reconcile + fill source
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

assert.match(version, /APP_BUILD = 380/);
assert.ok(existsSync(join(root, "functions/extract-cash-deposit.js")));
assert.match(index, /extractCashDepositSlip/);
assert.match(cf, /mode === "bank"/);
assert.match(cf, /BANK_SYSTEM_PROMPT|สลิปโอนเงิน/);
assert.match(cf, /DAY_SYSTEM_PROMPT|เงินสด/);
assert.match(cf, /transferFee/);
assert.match(client, /extractCashBankSlipFromPhotos/);
assert.match(client, /extractCashDaySlipFromPhotos/);
assert.match(lib, /transferFee/);
assert.match(lib, /CashFillSource/);
assert.match(lib, /bankAmountSource/);
assert.match(lib, /cashAmountSource/);
assert.match(panel, /runAiBank/);
assert.match(panel, /runAiDay/);
assert.match(panel, /คชจ\.โอน|transferFee/);
assert.match(panel, /ใส่โดยพนักงาน|is-staff|cash-in-src/);
assert.match(panel, /อ่าน AI ใหม่/);

const runner = `
import assert from "node:assert/strict";
import { cashDepositVariance } from "../src/lib/cash-deposits.ts";

assert.equal(cashDepositVariance(10000, 10000, 0), 0);
assert.equal(cashDepositVariance(9950, 10000, 50), 0);
assert.equal(cashDepositVariance(10000, 10000, 50), 50);
assert.equal(cashDepositVariance(9900, 10000, 0), -100);
console.log("OK fee reconcile math");
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
