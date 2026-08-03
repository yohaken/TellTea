/**
 * Gate: cash-in 「โอนแล้ว」requires bank e-slip — ใบรอบ alone is not transfer.
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
const doc = read("docs/npos-remit-rounds-phases.md");

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 672, `APP_BUILD >= 672, got ${buildMatch[1]}`);

assert.match(cash, /deriveCashDepositTransferUiState/);
assert.match(cash, /cashDepositHasBankSlipEvidence/);
assert.match(cash, /awaiting_bank_slip/);
assert.match(cash, /รอสลิปโอน/);
assert.match(cash, /ต้องแนบรูปสลิปโอนเข้าบัญชีอย่างน้อย 1 รูป/);
assert.match(cash, /ใบรอบ POS ไม่นับ/);

assert.match(panel, /labelCashDepositTransferUiState/);
assert.match(panel, /transferUiClass/);
assert.match(panel, /deriveCashDepositTransferUiState/);
assert.match(panel, /bankSlipUrlCount/);
assert.match(panel, /ต้องแนบรูปสลิปโอนเข้าบัญชีอย่างน้อย 1 รูป/);
// Overview is transfer-focused — round docs live on bill cards when opening a round
assert.doesNotMatch(panel, /title="ใบรอบ POS — เทียบตัวเลข ไม่ใช่สลิปโอน"/);
assert.match(panel, /สลิปโอนเข้าบัญชี — ใบรอบดูในบิลเมื่อเปิดมัด/);

assert.match(doc, /R2\.13|รอสลิปโอน/);

console.log("OK test-cash-in-bank-slip-status");
