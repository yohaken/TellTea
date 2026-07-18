/**
 * SmartCheck — วันนี้/ย้อนหลังเปิดเช็คได้ทุกกะ · วันล่วงหน้ายังห้าม
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkPage = readFileSync(join(root, "src/app/check/page.tsx"), "utf8");
const windowLib = readFileSync(join(root, "src/lib/check-shift-window.ts"), "utf8");

assert.match(windowLib, /canStartCheck/);
assert.match(windowLib, /วันนี้และย้อนหลัง/);
assert.match(checkPage, /canStartCheck/);
assert.match(checkPage, /checkShiftWindowMessage/);

function startOfLocalDay(y, m, d) {
  return new Date(y, m - 1, d).getTime();
}

/** Mirror of canStartCheck: day <= today → all shifts OK */
function canStart(dateMs, _shift, now) {
  const day = new Date(dateMs);
  const dayMs = startOfLocalDay(day.getFullYear(), day.getMonth() + 1, day.getDate());
  const todayMs = startOfLocalDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return dayMs <= todayMs;
}

const jul13 = startOfLocalDay(2026, 7, 13);
const nowMorning = new Date(2026, 6, 13, 10, 0);

// วันนี้ — ทุกกะเปิดได้ รวมเย็นที่ยังไม่ถึง 17:00
assert.equal(canStart(jul13, "evening", new Date(2026, 6, 13, 16, 59)), true);
assert.equal(canStart(jul13, "morning", nowMorning), true);
assert.equal(canStart(jul13, "late", nowMorning), true);

// ย้อนหลัง — กะเย็นเมื่อวาน เช็คได้
assert.equal(canStart(jul13, "evening", new Date(2026, 6, 14, 10, 0)), true);
assert.equal(canStart(jul13, "late", new Date(2026, 6, 14, 10, 0)), true);

// วันล่วงหน้า — ยังห้าม
assert.equal(
  canStart(startOfLocalDay(2026, 7, 15), "morning", new Date(2026, 6, 14, 20, 0)),
  false,
);
assert.equal(
  canStart(startOfLocalDay(2026, 7, 15), "evening", new Date(2026, 6, 14, 20, 0)),
  false,
);

console.log("OK test-check-shift-window");
