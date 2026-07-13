/**
 * SmartCheck — ห้ามเช็คล่วงหน้า · เช็คย้อนหลังได้
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkPage = readFileSync(join(root, "src/app/check/page.tsx"), "utf8");
const windowLib = readFileSync(join(root, "src/lib/check-shift-window.ts"), "utf8");

assert.match(windowLib, /canStartCheck/);
assert.match(checkPage, /canStartCheck/);
assert.match(checkPage, /checkShiftWindowMessage/);

const LATE_START = 18;
const MORNING = 7 * 60;
const EVENING = 17 * 60;

function startOfLocalDay(y, m, d) {
  return new Date(y, m - 1, d).getTime();
}

function windowStart(dateMs, shift) {
  const d = new Date(dateMs);
  const dayMs = startOfLocalDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const next = dayMs + 86_400_000;
  if (shift === "late") return dayMs + LATE_START * 60 * 1000;
  if (shift === "morning") return dayMs + MORNING * 60 * 1000;
  return dayMs + EVENING * 60 * 1000;
}

function canStart(dateMs, shift, now) {
  return now.getTime() >= windowStart(dateMs, shift);
}

const jul13 = startOfLocalDay(2026, 7, 13);

// ห้ามล่วงหน้า — กะเย็นยังไม่ถึง 17:00
assert.equal(canStart(jul13, "evening", new Date(2026, 6, 13, 16, 59)), false);

// อยู่ในกะดึก 00:20 — เช็คได้
assert.equal(canStart(jul13, "late", new Date(2026, 6, 13, 0, 20)), true);

// เช็คย้อนหลัง — กะเย็นเมื่อวาน เช็คได้วันรุ่งขึ้นตอนเช้า
assert.equal(canStart(jul13, "evening", new Date(2026, 6, 14, 10, 0)), true);

// ห้ามล่วงหน้า — กะเช้าพรุ่งนี้
assert.equal(
  canStart(startOfLocalDay(2026, 7, 15), "morning", new Date(2026, 6, 14, 20, 0)),
  false,
);

console.log("OK test-check-shift-window");
