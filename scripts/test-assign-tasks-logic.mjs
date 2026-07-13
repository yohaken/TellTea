/**
 * Weekly task logic + wiring tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dueDateForWeekContaining(ms, weekday) {
  const todayStart = startOfLocalDay(ms);
  const todayDay = new Date(todayStart).getDay();
  const daysBack = (todayDay - weekday + 7) % 7;
  return todayStart - daysBack * DAY_MS;
}

function openAtForDue(dueDate, openDaysBefore = 3) {
  return startOfLocalDay(dueDate) - openDaysBefore * DAY_MS;
}

function shouldMarkMissed(dueDate, now, openDaysBefore = 3) {
  const nextDue = dueDate + 7 * DAY_MS;
  return now >= openAtForDue(nextDue, openDaysBefore);
}

function computeCompletedKind(dueDate, completedAt, wasMissed) {
  if (wasMissed) return "backfill";
  if (startOfLocalDay(completedAt) <= startOfLocalDay(dueDate)) return "on_time";
  return "late";
}

function canSubmitOccurrence(status, openAt, now) {
  if (status === "completed") return false;
  if (status === "missed") return true;
  return now >= openAt;
}

// Monday 14 July 2025 12:00 local — use explicit date
const mon14 = new Date(2025, 6, 14, 12, 0, 0).getTime();
const fri11 = new Date(2025, 6, 11, 12, 0, 0).getTime();
const wed9 = new Date(2025, 6, 9, 12, 0, 0).getTime();
const mon21 = new Date(2025, 6, 21, 12, 0, 0).getTime();

const dueMon = dueDateForWeekContaining(mon14, 1);
assert.equal(new Date(dueMon).getDay(), 1);

const openThu = openAtForDue(dueMon, 3);
assert.equal(canSubmitOccurrence("pending", openThu, fri11), true);
assert.equal(canSubmitOccurrence("pending", openThu, wed9), false);
assert.equal(canSubmitOccurrence("missed", openThu, mon21), true);

assert.equal(computeCompletedKind(dueMon, dueMon, false), "on_time");
assert.equal(computeCompletedKind(dueMon, dueMon + DAY_MS, false), "late");
assert.equal(computeCompletedKind(dueMon, mon21, true), "backfill");

assert.equal(shouldMarkMissed(dueMon, mon14, 3), false);
assert.equal(shouldMarkMissed(dueMon, mon21, 3), true);

const pageSrc = readFileSync(join(root, "src/app/tasks/page.tsx"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");
const fnSrc = readFileSync(join(root, "functions/index.js"), "utf8");

assert.match(pageSrc, /subscribeTaskTemplates/);
assert.match(pageSrc, /subscribeTaskOccurrences/);
assert.match(pageSrc, /subscribeTaskOccurrencesForAssignee/);
assert.match(pageSrc, /runTaskOccurrenceSync/);
assert.match(rulesSrc, /match \/taskTemplates\/\{id\}/);
assert.match(rulesSrc, /match \/taskOccurrences\/\{id\}/);
assert.match(fnSrc, /syncTaskOccurrencesDaily/);

console.log("OK weekly task logic + wiring");
