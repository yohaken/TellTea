/**
 * OT incomplete past-shift popup — date-first past window + photos in completeness
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const windowLib = read("src/lib/check-shift-window.ts");
const sessionLib = read("src/lib/shift-session.ts");
const otPage = read("src/app/ot/page.tsx");
const popup = read("src/components/OtIncompletePopup.tsx");
const steps = read("src/components/ShiftProgressSteps.tsx");

assert.match(windowLib, /export function isOtShiftWorkWindowPast/);
assert.match(windowLib, /ดูวันที่ของช่องก่อน/);
assert.match(sessionLib, /photosComplete/);
assert.match(sessionLib, /รูปภาพ/);
assert.match(sessionLib, /listPastIncompleteOtShifts/);
assert.match(sessionLib, /includeEmptySlots/);
assert.match(otPage, /OtIncompletePopup/);
assert.match(otPage, /listPastIncompleteOtShifts/);
assert.match(otPage, /photosComplete: imageUrls\.length > 0/);
assert.match(otPage, /แนบรูปอย่างน้อย 1 รูป/);
assert.match(popup, /ต้องทำ:/);
assert.match(popup, /ผ่านเวลาทำงานแล้ว/);
assert.match(steps, /photosComplete/);

// Mirror date-first past logic
function startOfLocalDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function checkShiftWindowMs(dateMs, shift) {
  const dayMs = startOfLocalDay(dateMs);
  const next = dayMs + 86_400_000;
  const LATE = 18;
  const MORNING = 7 * 60;
  const EVENING = 17 * 60;
  if (shift === "late") {
    return { startMs: dayMs + LATE * 60_000, endMs: dayMs + MORNING * 60_000 };
  }
  if (shift === "morning") {
    return { startMs: dayMs + MORNING * 60_000, endMs: dayMs + EVENING * 60_000 };
  }
  return { startMs: dayMs + EVENING * 60_000, endMs: next + LATE * 60_000 };
}
function isPast(dateMs, shift, now) {
  const dayMs = startOfLocalDay(dateMs);
  const todayMs = startOfLocalDay(now.getTime());
  if (dayMs > todayMs) return false;
  if (dayMs < todayMs) return true;
  return checkShiftWindowMs(dayMs, shift).endMs <= now.getTime();
}

const day = (y, m, d) => new Date(y, m - 1, d).getTime();
const now = new Date(2026, 7, 13, 10, 0); // 13 Aug 2026 10:00

assert.equal(isPast(day(2026, 8, 12), "evening", now), true); // yesterday all past
assert.equal(isPast(day(2026, 8, 12), "morning", now), true);
assert.equal(isPast(day(2026, 8, 13), "late", now), true); // today late ended 07:00
assert.equal(isPast(day(2026, 8, 13), "morning", now), false); // morning ends 17:00
assert.equal(isPast(day(2026, 8, 13), "evening", now), false);
assert.equal(isPast(day(2026, 8, 14), "late", now), false); // future day

// Time-only without date would wrongly mark morning past at 10:00 on a future day — we reject future day
assert.equal(isPast(day(2026, 8, 20), "morning", now), false);

console.log("OK test-ot-incomplete-popup");
