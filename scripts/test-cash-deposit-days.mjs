/**
 * Pure coverage rules: flexible rounds, 1 bill = 1 day, no dup/gap/month overflow.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = readFileSync(join(root, "src/lib/cash-deposits.ts"), "utf8");
const panel = readFileSync(join(root, "src/components/CashInLedgerPanel.tsx"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 653, `APP_BUILD >= 653, got ${buildMatch[1]}`);
assert.match(lib, /CASH_DEPOSIT_DAY_MAX = 31/);
assert.match(lib, /export function analyzeCashDepositDays/);
assert.match(lib, /export function buildCashDepositRoundDays/);
assert.match(lib, /drawerCloseAmount/);
assert.match(lib, /allowGaps|ข้ามวัน|month_overflow/);
assert.match(panel, /is-tick|cash-in-bill-main|clearAllTicks/);
assert.match(panel, /cash-in-slim/);
assert.match(panel, /cash-in-issues/);
assert.match(rules, /days\.size\(\) <= 31/);

const runner = `
import assert from "node:assert/strict";
import {
  analyzeCashDepositDays,
  buildCashDepositOccupancy,
  buildCashDepositRoundDays,
  addCalendarDays,
  cashDepositDayKey,
} from "../src/lib/cash-deposits.ts";

const end = cashDepositDayKey(new Date(2024, 6, 25).getTime()); // 25 Jul 2024
const round7 = buildCashDepositRoundDays(end, 7);
assert.equal(round7.length, 7);
assert.equal(round7[0].date, addCalendarDays(end, -6));
assert.equal(round7[6].date, end);

const ok = analyzeCashDepositDays(round7.map((d) => ({ date: d.date, cashAmount: 100 })));
assert.equal(ok.issues.length, 0);
assert.equal(ok.dayCount, 7);

const dup = analyzeCashDepositDays([
  { date: end, cashAmount: 10 },
  { date: end, cashAmount: 20 },
]);
assert.ok(dup.issues.some((i) => i.code === "duplicate"));

const gapDays = [
  { date: addCalendarDays(end, -2), cashAmount: 10 },
  { date: end, cashAmount: 10 },
];
// Default: มัดรวมบิลข้ามวันได้
const gapOk = analyzeCashDepositDays(gapDays);
assert.equal(gapOk.issues.filter((i) => i.code === "gap").length, 0);
const gapStrict = analyzeCashDepositDays(gapDays, { allowGaps: false });
assert.ok(gapStrict.issues.some((i) => i.code === "gap"));
// ยอด 0 ทั้งมัดรวม → bad_amount
const zeroOnly = analyzeCashDepositDays([{ date: end, cashAmount: 0 }]);
assert.ok(zeroOnly.issues.some((i) => i.code === "bad_amount"));

const occupied = buildCashDepositOccupancy([
  {
    id: "a",
    status: "matched",
    days: [{ date: end, cashAmount: 1, id: "x", slipKind: "daily", shiftLabel: "", note: "", slipUrls: [] }],
  },
]);
const overlap = analyzeCashDepositDays(
  [{ date: end, cashAmount: 50 }],
  { occupiedByDepositId: occupied.occupiedByDepositId, occupiedMonthCounts: occupied.occupiedMonthCounts },
);
assert.ok(overlap.issues.some((i) => i.code === "overlap"));

// 32 days in one month → overflow
const janStart = cashDepositDayKey(new Date(2024, 0, 1).getTime());
const tooMany = [];
for (let i = 0; i < 32; i++) tooMany.push({ date: addCalendarDays(janStart, i), cashAmount: 1 });
const overflow = analyzeCashDepositDays(tooMany);
assert.ok(overflow.issues.some((i) => i.code === "too_long" || i.code === "month_overflow"));

console.log("OK analyzeCashDepositDays runtime");
`;

const tmp = join(root, "scripts/.tmp-cash-deposit-days-run.mts");
import { writeFileSync, unlinkSync } from "node:fs";
writeFileSync(tmp, runner);
const res = spawnSync("npx", ["--yes", "tsx", tmp], { cwd: root, encoding: "utf8" });
try {
  unlinkSync(tmp);
} catch {
  /* ignore */
}
if (res.status !== 0) {
  console.error(res.stdout);
  console.error(res.stderr);
  process.exit(res.status || 1);
}
process.stdout.write(res.stdout);
console.log("OK test-cash-deposit-days");
