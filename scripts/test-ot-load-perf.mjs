/**
 * OT /ot/ load perf: bounded Firestore listeners + grid/render guards.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const otLib = read("src/lib/ot.ts");
const checklist = read("src/lib/checklist.ts");
const shiftSession = read("src/lib/shift-session.ts");
const otPage = read("src/app/ot/page.tsx");
const bonusPage = read("src/app/bonus/page.tsx");
const version = read("src/lib/version.ts");

assert.match(otLib, /OT_HISTORY_LOOKBACK_DAYS = 60/);
assert.match(otLib, /otHistorySinceMs/);
assert.match(otLib, /opts\?: \{ since\?: number \}/);
assert.match(otLib, /where\("date", ">=", since\)/);

assert.match(checklist, /CHECK_HISTORY_LOOKBACK_DAYS = 60/);
assert.match(checklist, /checkHistorySinceMs/);
assert.match(checklist, /where\("date", ">=", since\)/);

assert.match(shiftSession, /indexChecklistRecordsByDayShift/);
assert.match(shiftSession, /recordsByDayShift/);

assert.match(otPage, /otHistorySinceMs\(\)/);
assert.match(otPage, /checkHistorySinceMs\(\)/);
assert.match(otPage, /\{ since \}/);
assert.match(otPage, /minDate: historySinceMs/);
assert.match(otPage, /entriesReady/);
assert.match(otPage, /checksReady/);
assert.match(otPage, /recordsByDayShift: checkRecordsByDayShift/);
assert.match(otPage, /OT_HISTORY_LOOKBACK_DAYS\} วันล่าสุด/);

assert.match(bonusPage, /since: monthSince/);
assert.match(version, /APP_BUILD = 412/);

// Pure lookback helper mirror
function otHistorySinceMs(now, days = 60) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - Math.max(1, Math.floor(days)));
  return d.getTime();
}

const noon = new Date(2026, 6, 29, 12, 0, 0).getTime();
const since = otHistorySinceMs(noon, 60);
const expected = new Date(2026, 4, 30).getTime(); // 60 days before Jul 29 local midnight
assert.equal(since, expected);

console.log("OK test-ot-load-perf", { lookbackDays: 60, since });
