/**
 * SmartCheck — เช็คได้เฉพาะในช่วงเวลากะ (ไม่เช็คล่วงหน้า)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkPage = readFileSync(join(root, "src/app/check/page.tsx"), "utf8");
const windowLib = readFileSync(join(root, "src/lib/check-shift-window.ts"), "utf8");

assert.match(windowLib, /isCheckShiftOpen/);
assert.match(windowLib, /getActiveCheckSlot/);
assert.match(checkPage, /isCheckShiftOpen/);
assert.match(checkPage, /checkShiftWindowMessage/);

const LATE_START = 18;
const MORNING = 7 * 60;
const EVENING = 17 * 60;

function startOfLocalDay(y, m, d) {
  return new Date(y, m - 1, d).getTime();
}

function minsToMs(dayMs, mins) {
  return dayMs + mins * 60 * 1000;
}

function isOpen(dateMs, shift, now) {
  const dayMs = startOfLocalDay(
    new Date(dateMs).getFullYear(),
    new Date(dateMs).getMonth() + 1,
    new Date(dateMs).getDate(),
  );
  const next = dayMs + 86_400_000;
  let startMs;
  let endMs;
  if (shift === "late") {
    startMs = minsToMs(dayMs, LATE_START);
    endMs = minsToMs(dayMs, MORNING);
  } else if (shift === "morning") {
    startMs = minsToMs(dayMs, MORNING);
    endMs = minsToMs(dayMs, EVENING);
  } else {
    startMs = minsToMs(dayMs, EVENING);
    endMs = minsToMs(next, LATE_START);
  }
  const t = now.getTime();
  return t >= startMs && t < endMs;
}

const jul13 = startOfLocalDay(2026, 7, 13);
assert.equal(isOpen(jul13, "evening", new Date(2026, 6, 13, 18, 0)), true);
assert.equal(isOpen(jul13, "evening", new Date(2026, 6, 13, 16, 59)), false);
assert.equal(isOpen(jul13, "evening", new Date(2026, 6, 14, 0, 10)), true);
assert.equal(isOpen(startOfLocalDay(2026, 7, 15), "morning", new Date(2026, 6, 14, 20, 0)), false);

console.log("OK test-check-shift-window");
