/**
 * OT /ot/ load: month-scoped window + plan-ahead (not rolling 60-day dump).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const otLib = read("src/lib/ot.ts");
const otGrid = read("src/lib/ot-grid.ts");
const otWindow = read("src/lib/ot-view-window.ts");
const checklist = read("src/lib/checklist.ts");
const shiftSession = read("src/lib/shift-session.ts");
const otPage = read("src/app/ot/page.tsx");
const bonusPage = read("src/app/bonus/page.tsx");
const version = read("src/lib/version.ts");

assert.match(otLib, /opts\?: \{ since\?: number; until\?: number/);
assert.match(otLib, /where\("date", ">=", since\)/);

assert.match(otGrid, /OT_PLAN_AHEAD_DAYS = 4/);
assert.match(otGrid, /strictRange/);

assert.match(otWindow, /export function otViewWindow/);
assert.match(otWindow, /isLive/);
assert.match(otWindow, /OT_PLAN_AHEAD_DAYS/);

assert.match(checklist, /CHECK_HISTORY_LOOKBACK_DAYS = 60/);
assert.match(checklist, /checkHistorySinceMs/);
assert.match(checklist, /where\("date", ">=", since\)/);

assert.match(shiftSession, /indexChecklistRecordsByDayShift/);
assert.match(shiftSession, /recordsByDayShift/);

assert.match(otPage, /otViewWindow/);
assert.match(otPage, /viewMonth/);
assert.match(otPage, /type="month"/);
assert.match(otPage, /since, until/);
assert.match(otPage, /strictRange: true/);
assert.match(otPage, /entriesReady/);
assert.match(otPage, /checksReady/);
assert.match(otPage, /recordsByDayShift: checkRecordsByDayShift/);
assert.match(otPage, /เดือนนี้/);

assert.match(bonusPage, /since: monthSince/);
assert.match(version, /APP_BUILD = \d+/);

// Pure window helper mirror
function monthInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfLocalDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addLocalDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return startOfLocalDay(d.getTime());
}

function otViewWindow(periodMonth, now, planAheadDays = 4) {
  const [y, m] = periodMonth.split("-").map(Number);
  const monthStart = new Date(y, m - 1, 1).getTime();
  const nextMonthStart = new Date(y, m, 1).getTime();
  const today = startOfLocalDay(now);
  const liveMonth = monthInputValue(new Date(now));
  if (periodMonth === liveMonth) {
    const gridMax = addLocalDays(today, planAheadDays);
    return {
      since: monthStart,
      until: addLocalDays(gridMax, 1),
      gridMin: monthStart,
      gridMax,
      isLive: true,
    };
  }
  return {
    since: monthStart,
    until: nextMonthStart,
    gridMin: monthStart,
    gridMax: addLocalDays(nextMonthStart, -1),
    isLive: false,
  };
}

// Live Jul 30 → includes Aug 1–3 (plan ahead 4 → Aug 3)
const jul30 = new Date(2026, 6, 30, 12, 0, 0).getTime();
const live = otViewWindow("2026-07", jul30, 4);
assert.equal(live.isLive, true);
assert.equal(live.since, new Date(2026, 6, 1).getTime());
assert.equal(live.gridMax, new Date(2026, 7, 3).getTime());
assert.equal(live.until, new Date(2026, 7, 4).getTime());

// Past closed month — calendar only, no plan spill
const past = otViewWindow("2026-06", jul30, 4);
assert.equal(past.isLive, false);
assert.equal(past.since, new Date(2026, 5, 1).getTime());
assert.equal(past.until, new Date(2026, 6, 1).getTime());
assert.equal(past.gridMax, new Date(2026, 5, 30).getTime());

console.log("OK test-ot-load-perf", {
  planAheadDays: 4,
  liveUntil: new Date(live.until).toISOString(),
  pastMonth: "2026-06",
});
