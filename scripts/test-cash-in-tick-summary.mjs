/**
 * Gate: cash-in tick-to-transfer + top summary (no clutter bars)
 * ติ๊กบิล · ล้างได้ · สรุปบน · สลิปโอนหลายใบ · แนบใบ POS ที่ยอดบิล
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
const doc = read("docs/npos-remit-rounds-phases.md");

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 660, `APP_BUILD >= 660, got ${buildMatch[1]}`);

assert.match(panel, /function toggleSessionTick/);
assert.match(panel, /function clearAllTicks/);
assert.match(panel, /function attachPosPrintForSession/);
assert.match(panel, /is-tick/);
assert.match(panel, /cash-in-bill-main/);
assert.match(panel, /cash-in-bill-attach/);
assert.match(panel, /cash-in-summary-bar/);
assert.match(panel, /cash-in-summary-slips/);
assert.match(panel, /ยอดรวม/);
assert.match(panel, /โอนเงินตามยอดนี้/);
assert.match(panel, /คชจ\.โอน/);
assert.match(panel, /ยอดเข้าจริง/);
assert.match(panel, /สลิปโอนเงิน/);
assert.match(panel, /\+สลิปโอน/);
assert.match(panel, /แนบใบรอบ|attachPosPrintForSession/);
assert.match(panel, /ล้าง/);
assert.match(panel, /bundledBillCount >= 1/);
assert.match(panel, /linkedOutsideWorking/);
assert.match(panel, /รอโอน/);
assert.doesNotMatch(panel, /cash-in-bank-table is-edit/);
assert.doesNotMatch(panel, />\s*ในมัด\s*</);
assert.doesNotMatch(panel, />\s*ใคร\s*</);
assert.doesNotMatch(panel, /cash-in-bill-amt-btn/);
assert.match(cash, /suggestedNetBankTransfer/);
assert.match(css, /\.cash-in-summary-bar\b/);
assert.match(css, /\.cash-in-summary-slips\b/);
assert.match(css, /\.cash-in-bill-main\b/);
assert.match(css, /\.cash-in-bill-attach\b/);
assert.match(css, /\.cash-in-bill-check\b/);
assert.match(doc, /R2\.8|แตะครั้งเดียว|ปุ่มแนบ/);

console.log("OK test-cash-in-tick-summary");
