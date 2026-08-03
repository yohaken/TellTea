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
assert.ok(Number(buildMatch[1]) >= 672, `APP_BUILD >= 672, got ${buildMatch[1]}`);
assert.match(panel, /setSessionActualCash|ได้จริง/);
assert.match(panel, /cash-in-bill-compare/);
assert.match(panel, /ใบรอบ/);
assert.match(panel, /สลิปโอน/);
assert.match(panel, /bankSlipUrls/);

assert.match(panel, /function toggleSessionTick/);
assert.match(panel, /function clearAllTicks/);
assert.match(panel, /function attachPosPrintForSession/);
assert.match(panel, /function applyWorkingDays/);
assert.match(panel, /withRefreshedBankAmount/);
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
assert.match(panel, /บันทึกโอน/);
assert.match(panel, /bundledBillCount >= 1/);
assert.match(panel, /linkedOutsideWorking/);
assert.match(panel, /รอโอน/);
assert.doesNotMatch(panel, /cash-in-bank-table is-edit/);
assert.doesNotMatch(panel, />\s*ในมัด\s*</);
assert.doesNotMatch(panel, />\s*ใคร\s*</);
assert.doesNotMatch(panel, /cash-in-bill-amt-btn/);
assert.doesNotMatch(panel, /onVerify|cash-in-verify/);
assert.doesNotMatch(panel, /รอตรวจ/);
assert.match(cash, /suggestedNetBankTransfer/);
assert.match(cash, /status: "matched"/);
assert.match(cash, /โอนแล้ว/);
assert.doesNotMatch(cash, /Owner must re-check|owner must re-check/);
assert.match(css, /\.cash-in-summary-bar\b/);
assert.match(css, /\.cash-in-summary-slips\b/);
assert.match(css, /\.cash-in-bill-main\b/);
assert.match(css, /\.cash-in-bill-attach\b/);
assert.match(css, /\.cash-in-bill-check\b/);
assert.match(css, /not sticky|covering bill cards/);
assert.match(doc, /R2\.10|ไม่รอตรวจ/);

console.log("OK test-cash-in-tick-summary");
