/**
 * OT ↔ SmartCheck session lookup by date×shift.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function normalizeCheckDateMs(ms) {
  return startOfLocalDay(new Date(ms));
}

const jul13 = new Date(2026, 6, 13).getTime();
assert.equal(normalizeCheckDateMs(jul13), jul13);
assert.equal(normalizeCheckDateMs(jul13 + 3600000), jul13);

const otSrc = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");
const checklistSrc = readFileSync(join(root, "src/lib/checklist.ts"), "utf8");
const checkSrc = readFileSync(join(root, "src/app/check/page.tsx"), "utf8");

assert.match(checklistSrc, /subscribeCheckSessionForShift/);
assert.match(checklistSrc, /normalizeCheckDateMs/);
assert.match(otSrc, /subscribeCheckSessionForShift/);
assert.match(otSrc, /ไม่ต้องเช็คซ้ำ/);
assert.match(checkSrc, /เช็คแล้ว — กลับ/);

console.log("OK ot-check gate");
