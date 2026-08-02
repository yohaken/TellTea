/**
 * Guard: staff/preview production log uses month scope + month picker.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "src/app/production/page.tsx"), "utf8");

assert.match(page, /aria-label="เดือนอ้างอิง"/);
assert.match(page, /resolveMyWorkerId/);
assert.match(page, /workerId: filterId/);
assert.match(page, /monthWindow/);
assert.doesNotMatch(
  page,
  /prodHistorySinceMs/,
  "staff prod log must not use long lookback without month",
);
assert.match(page, /isPermPreview && showLog/);
assert.match(page, /พรีวิว — กรอกไม่ได้/);
assert.match(page, /canOpenRow/);
assert.match(page, /staffHomeHref/);
assert.match(page, /mineOnly=\{!shopProdView\}/);
assert.match(page, /mineOnly \? null/);

console.log("OK test-production-staff-month");
