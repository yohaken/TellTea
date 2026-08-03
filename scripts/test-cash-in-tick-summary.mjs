/**
 * Gate: cash-in tick-to-transfer + sticky summary
 * ติ๊กบิล POS → สรุป ยอดรวม → โอนตามยอดนี้ → รวม−คชจ.=เข้าจริง
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
assert.ok(Number(buildMatch[1]) >= 658, `APP_BUILD >= 658, got ${buildMatch[1]}`);

assert.match(panel, /function toggleSessionTick/);
assert.match(panel, /is-tick/);
assert.match(panel, /cash-in-summary-bar/);
assert.match(panel, /ยอดรวม/);
assert.match(panel, /โอนเงินตามยอดนี้/);
assert.match(panel, /คชจ\.โอน/);
assert.match(panel, /ยอดเข้าจริง/);
assert.match(panel, /ยอดโอนรวม.*คชจ/);
assert.match(panel, /bundledBillCount >= 1/);
assert.match(panel, /linkedOutsideWorking/);
assert.match(panel, /untickedPendingSessions/);
assert.match(panel, /รอโอน/);
assert.match(cash, /suggestedNetBankTransfer/);
assert.match(css, /\.cash-in-summary-bar\b/);
assert.match(css, /\.cash-in-bill-check\b/);
assert.match(css, /position:\s*sticky/);
assert.match(doc, /R2\.6|ติ๊กบิล \+ สรุปล่าง/);

console.log("OK test-cash-in-tick-summary");
