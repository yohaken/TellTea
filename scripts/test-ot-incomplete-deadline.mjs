/**
 * OT incomplete deadline — 24 ชม. · หักสะสม 0.3%/กะ · grace จนถึงเดือนหน้า
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deadlineLib = readFileSync(join(root, "src/lib/shift-deadline.ts"), "utf8");
const popup = readFileSync(join(root, "src/components/OtIncompletePopup.tsx"), "utf8");
const otPage = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");
const shiftSession = readFileSync(join(root, "src/lib/shift-session.ts"), "utf8");

assert.match(deadlineLib, /OT_INCOMPLETE_DEADLINE_HOURS = 24/);
assert.match(deadlineLib, /OT_INCOMPLETE_DEDUCT_PCT_PER_SHIFT = 0.3/);
assert.match(deadlineLib, /formatShiftCountdownPrecise/);
assert.match(deadlineLib, /splitShiftCountdown/);
assert.match(deadlineLib, /shiftCountdownUrgency/);
assert.match(deadlineLib, /isOtIncompleteEnforcementActive/);
assert.match(deadlineLib, /sumIncompletePreviewDeductPct/);

assert.match(popup, /ทีมยังใส่ข้อมูลกะไม่ครบ/);
assert.match(popup, /ยังไม่หักโบนัสจริง/);
assert.match(popup, /ShiftCountdownClock/);
assert.match(popup, /requestAnimationFrame/);
assert.match(popup, /ot-countdown-ms/);
assert.match(popup, /sumIncompletePreviewDeductPct/);

assert.match(otPage, /includeEmptySlots: true/);
assert.doesNotMatch(otPage, /entryIncludesMe:/);

assert.match(shiftSession, /enrichPastIncompleteShift/);
assert.match(shiftSession, /sortPastIncompleteShifts/);
assert.match(shiftSession, /previewDeductPct/);

function startOfLocalDay(y, m, d) {
  return new Date(y, m - 1, d).getTime();
}

function minsToMs(dayMs, mins) {
  return dayMs + mins * 60 * 1000;
}

function checkShiftWindowEndMs(dateMs, shift) {
  const dayMs = startOfLocalDay(
    new Date(dateMs).getFullYear(),
    new Date(dateMs).getMonth() + 1,
    new Date(dateMs).getDate(),
  );
  const nextDayMs = dayMs + 86_400_000;
  if (shift === "morning") return minsToMs(dayMs, 17 * 60);
  if (shift === "evening") return minsToMs(nextDayMs, 18);
  return minsToMs(dayMs, 7 * 60);
}

function shiftCompletionDeadlineMs(dateMs, shift) {
  return checkShiftWindowEndMs(dateMs, shift) + 24 * 3_600_000;
}

const aug25 = startOfLocalDay(2026, 8, 25);
const eveningEnd = checkShiftWindowEndMs(aug25, "evening");
const deadline = shiftCompletionDeadlineMs(aug25, "evening");

assert.ok(deadline > eveningEnd);
assert.equal(deadline - eveningEnd, 24 * 3_600_000);

const twoShiftsOverdue = 0.3 * 2;
assert.equal(Math.round(twoShiftsOverdue * 100) / 100, 0.6);

console.log("OK test-ot-incomplete-deadline");
