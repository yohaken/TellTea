/**
 * Gate: cash-in 「ต้องโอน」= nPos remits only (no FoodStory AI day / manual rounds).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const buildMatch = version.match(/APP_BUILD\s*=\s*(\d+)/);
assert.ok(buildMatch);
assert.ok(Number(buildMatch[1]) >= 660, `APP_BUILD >= 660, got ${buildMatch[1]}`);

const remit = read("src/lib/pos-session-remit.ts");
assert.match(remit, /CASH_IN_NPOS_REMIT_ONLY\s*=\s*true/);
assert.match(remit, /export function isManualPosSession/);
assert.match(remit, /export function isCashInRemitSession/);
assert.match(remit, /isCashInRemitSession\(s\)/);

const cash = read("src/lib/cash-deposits.ts");
assert.match(cash, /export function assertCashDepositDaysNposLinked/);

const panel = read("src/components/CashInLedgerPanel.tsx");
assert.match(panel, /assertCashDepositDaysNposLinked/);
assert.match(panel, /is-tick|toggleSessionTick|queueSessionIntoWorking/);
assert.match(panel, /clearAllTicks|ล้าง/);
assert.match(panel, /cash-in-bill-main|cash-in-bill-attach/);
assert.match(panel, /ทุกใบ|queueAllPendingIntoWorking/);
assert.match(panel, /โอนนำเข้า/);
assert.match(panel, /cash-in-summary-bar|ยอดเข้าจริง/);
assert.match(panel, /cash-in-summary-slips|สลิปโอนเงิน/);
assert.match(panel, /cash-in-compact-btn/);
assert.doesNotMatch(panel, /\+รอบ|startCreateRound|cash-in-create-bar/);
assert.doesNotMatch(panel, /\+ วันก่อนหน้า|\+ วันถัดไป/);
assert.doesNotMatch(panel, /runAiDay|extractCashDaySlipFromPhotos/);
assert.match(cash, /suggestedNetBankTransfer/);
assert.match(cash, /allowGaps/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /CASH_IN_NPOS_REMIT_ONLY/);
assert.match(slim, /ยอดต้องโอนใช้รอบ nPos อย่างเดียว/);

const doc = read("docs/npos-remit-rounds-phases.md");
assert.match(doc, /ติ๊กบิล|มัดรวม|CASH_IN_NPOS_REMIT_ONLY|nPos-only/);

const runner = `
import assert from "node:assert/strict";
import {
  assertCashDepositDaysNposLinked,
  cashDepositVariance,
  suggestedNetBankTransfer,
} from "../src/lib/cash-deposits.ts";
import {
  CASH_IN_NPOS_REMIT_ONLY,
  isCashInRemitSession,
  isManualPosSession,
  pendingDepositSessionsForCashIn,
  sessionsForCashDepositDay,
} from "../src/lib/pos-session-remit.ts";

assert.equal(CASH_IN_NPOS_REMIT_ONLY, true);
assert.equal(suggestedNetBankTransfer(10000, 20), 9980);
assert.equal(suggestedNetBankTransfer(10000, 0), 10000);
assert.equal(cashDepositVariance(9980, 10000, 20), 0);
assert.equal(isManualPosSession({ source: "manual", deviceId: "manual" }), true);
assert.equal(isManualPosSession({ source: "npos", deviceId: "abc" }), false);
assert.equal(isCashInRemitSession({ source: "manual", deviceId: "manual" }), false);
assert.equal(isCashInRemitSession({ source: "npos", deviceId: "abc" }), true);

const day = new Date("2026-08-02T00:00:00+07:00").getTime();
const npos = {
  id: "npos_1",
  status: "closed",
  source: "npos",
  deviceId: "tablet1",
  date: day,
  remitAmount: 1200,
};
const manual = {
  id: "manual_1",
  status: "closed",
  source: "manual",
  deviceId: "manual",
  date: day,
  remitAmount: 999,
};
const pending = pendingDepositSessionsForCashIn([npos, manual], new Set());
assert.equal(pending.length, 1);
assert.equal(pending[0].id, "npos_1");

const forDay = sessionsForCashDepositDay([npos, manual], day);
assert.equal(forDay.length, 1);
assert.equal(forDay[0].id, "npos_1");

assert.doesNotThrow(() =>
  assertCashDepositDaysNposLinked([
    { date: day, cashAmount: 0, sessionIds: [] },
    { date: day, cashAmount: 1200, sessionIds: ["npos_1"] },
  ]),
);
assert.throws(
  () =>
    assertCashDepositDaysNposLinked([
      { date: day, cashAmount: 500, sessionIds: [] },
    ]),
  /nPos/,
);

console.log("OK cash-in nPos-only helpers");
`;
const tmp = join(root, "scripts/.tmp-cash-in-npos-only.mts");
writeFileSync(tmp, runner);
const res = spawnSync("npx", ["--yes", "tsx", tmp], { cwd: root, encoding: "utf8" });
try {
  unlinkSync(tmp);
} catch {
  /* ignore */
}
if (res.status !== 0) {
  console.error(res.stdout || "");
  console.error(res.stderr || "");
  process.exit(res.status || 1);
}
console.log(res.stdout.trim());
console.log("OK test-cash-in-npos-only");
