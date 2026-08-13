/**
 * Customer join/claim spin — resume, retry, frozen settings
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const onceSrc = read("src/components/PointsGameOnce.tsx");
const joinSrc = read("src/app/join/page.tsx");
const claimSrc = read("src/app/claim/page.tsx");
const creditSrc = read("src/lib/points-spin-credit.ts");
const fnSrc = read("functions/pos-members.js");
const attractSrc = read("src/components/PointsGamesAttractBg.tsx");

assert.match(creditSrc, /isSpinCreditRetryable/);
assert.match(onceSrc, /creditRetryable/);
assert.match(onceSrc, /บันทึกแต้มอีกครั้ง/);
assert.match(onceSrc, /prev \?\? /);
assert.match(onceSrc, /กำลังโหลดวงล้อ/);

assert.match(joinSrc, /showGame = !!done && !!spinPlayToken/);
assert.match(joinSrc, /settings=\{spinSettings\}/);
assert.match(joinSrc, /applySpinCredit/);
assert.match(joinSrc, /isSpinCreditRetryable/);

assert.match(claimSrc, /gameLatched/);
assert.match(claimSrc, /spinGameCredited/);
assert.match(claimSrc, /applySpinCredit/);
assert.match(claimSrc, /settings=\{spinSettings\}/);
assert.match(claimSrc, /หมุนลุ้นแต้มได้เพิ่มให้ครบ/);

assert.match(fnSrc, /spinGameCredited: data\.spinGameCredited === true/);
assert.match(fnSrc, /balanceAfter/);

assert.match(attractSrc, /settings \?/);
assert.doesNotMatch(attractSrc, /DEFAULT_POINTS_SPIN_SETTINGS/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 807);

console.log("OK test-customer-spin-resilience");
