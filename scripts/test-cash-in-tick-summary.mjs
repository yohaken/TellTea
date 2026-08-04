/**
 * Gate: cash-in tick-to-transfer + top summary (no round-doc attach)
 * ติ๊กบิล · สรุปยอดโอน − คชจ. · ส่วนต่างแดง/เขียว · สลิปโอน
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
assert.ok(Number(buildMatch[1]) >= 696, `APP_BUILD >= 696, got ${buildMatch[1]}`);
assert.match(panel, /cash-in-bill-shift-name/);
assert.match(panel, /cash-in-bill-line/);
assert.match(panel, /formatCashInDayHm/);
assert.match(panel, /formatCashInDurationHm/);
assert.match(panel, /posSessionDurationMs/);
assert.match(panel, /เงินสดรอนำเข้า/);
assert.match(panel, /cash-in-pending-title/);
assert.match(panel, /cash-in-bill-shift-duration/);
assert.match(css, /\.cash-in-bill-line\b/);
assert.match(css, /\.cash-in-bill-shift-part\.is-open/);
assert.match(css, /\.cash-in-bill-shift-part\.is-close/);
assert.match(css, /\.cash-in-pending-title\b/);
assert.match(css, /\.cash-in-bill-shift-duration\b/);

assert.match(panel, /function toggleSessionTick/);
assert.match(panel, /function clearAllTicks/);
assert.match(panel, /function applyWorkingDays/);
assert.match(panel, /withRefreshedBankAmount/);
assert.match(panel, /formatCashInHm/);
assert.match(panel, /openedByName/);
assert.match(panel, /closedByName/);
assert.match(panel, /cash-in-bill-shift/);
assert.match(panel, /is-tick/);
assert.match(panel, /cash-in-bill-card/);
assert.match(panel, /cash-in-summary-bar/);
assert.match(panel, /cash-in-summary-slips/);
assert.match(panel, /ยอดรวม/);
assert.match(panel, /โอนเงินตามยอดนี้/);
assert.match(panel, /คชจ\.โอน/);
assert.match(panel, /ควรเข้าบัญชี/);
assert.match(panel, /ยอดสลิปโอน/);
assert.match(panel, /ส่วนต่าง/);
assert.match(panel, /is-diff/);
assert.match(panel, /สลิปโอนเงิน/);
assert.match(panel, /\+สลิปโอน/);
assert.match(panel, /ล้าง/);
assert.match(panel, /บันทึกโอน/);
assert.match(panel, /bundledBillCount >= 1/);
assert.match(panel, /linkedOutsideWorking/);
assert.match(panel, /เงินสดรอนำเข้า/);
assert.doesNotMatch(panel, /attachPosPrintForSession/);
assert.doesNotMatch(panel, /cash-in-bill-attach/);
assert.doesNotMatch(panel, /setSessionActualCash/);
assert.doesNotMatch(panel, /ได้จริง/);
assert.doesNotMatch(panel, /openDayPhoto/);
assert.doesNotMatch(panel, /cash-in-bank-table is-edit/);
assert.doesNotMatch(panel, />\s*ในมัด\s*</);
assert.doesNotMatch(panel, /onVerify|cash-in-verify/);
assert.doesNotMatch(panel, /รอตรวจ/);
assert.match(cash, /suggestedNetBankTransfer/);
assert.match(cash, /status: "matched"/);
assert.match(cash, /โอนแล้ว/);
assert.match(css, /\.cash-in-summary-bar\b/);
assert.match(css, /\.cash-in-summary-slips\b/);
assert.match(css, /\.cash-in-summary-row\.is-diff\b/);
assert.match(css, /\.cash-in-bill-card\b/);
assert.match(css, /\.cash-in-bill-check\b/);
assert.match(css, /\.cash-in-bill-shift\b/);
assert.match(doc, /R2\.16|วันที่ \+ ระยะกะ/);

console.log("OK test-cash-in-tick-summary");
