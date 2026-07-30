/**
 * Guard: remove bulk status on ชง/ผลิต; bonus month-close + lock.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const bonusClose = read("src/lib/bonus-month-close.ts");
const guard = read("src/lib/bonus-month-guard.ts");
const bonusPage = read("src/app/bonus/page.tsx");
const prodPage = read("src/app/production/page.tsx");
const otPage = read("src/app/ot/page.tsx");
const bonusLib = read("src/lib/bonus.ts");
const prodLib = read("src/lib/production.ts");
const rules = read("firestore.rules");
const assertRules = read("scripts/assert-firestore-rules.mjs");

assert.match(version, /APP_BUILD\s*=\s*485/);
assert.equal(existsSync(join(root, "src/components/BulkStatusToolbar.tsx")), false);

assert.match(guard, /export async function assertBonusMonthOpenForDate/);
assert.match(bonusClose, /export async function closeBonusMonth/);
assert.match(bonusClose, /lockBonusSourceEntriesForMonth/);
assert.match(bonusClose, /unlockBonusMonth/);
assert.match(bonusPage, /ปิดเดือนนี้/);
assert.match(bonusPage, /closeBonusMonth/);
assert.match(bonusPage, /reportFromCloseSnapshot/);
assert.match(bonusPage, /monthClosed/);

assert.doesNotMatch(prodPage, /BulkStatusToolbar/);
assert.doesNotMatch(otPage, /BulkStatusToolbar/);
assert.doesNotMatch(prodPage, /bulkUpdateProdEntryStatus/);
assert.doesNotMatch(otPage, /bulkUpdateOtEntryStatus/);
assert.doesNotMatch(prodPage, /เลือกรอจ่าย/);
assert.doesNotMatch(otPage, /เลือกเตรียมจ่าย/);
assert.match(prodPage, /ปิดเดือนโบนัส/);
assert.match(otPage, /ปิดเดือนโบนัส/);

assert.match(prodLib, /assertBonusMonthOpenForDate/);
assert.match(read("src/lib/ot.ts"), /assertBonusMonthOpenForDate/);
assert.match(bonusLib, /paid` is a lock flag|lock flag after month-close/);
assert.match(rules, /match \/bonusMonthCloses\/\{monthId\}/);
assert.match(assertRules, /"bonusMonthCloses"/);

console.log("OK test-bonus-month-close");
