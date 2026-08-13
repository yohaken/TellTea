/**
 * Members CRM — คงเหลือ / รวม / ใช้ไป / เกม / แต้มล่าสุด
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const membersLib = read("src/lib/members.ts");
const page = read("src/app/members/page.tsx");
const fn = read("functions/pos-members.js");

assert.match(membersLib, /lifetimePointsRedeemed/);
assert.match(membersLib, /lastPointsAt/);
assert.match(membersLib, /lifetimeEarnVisits/);
assert.match(membersLib, /pointsUsedForDisplay/);
assert.match(membersLib, /memberLastPointsAt/);
assert.match(membersLib, /memberSourceShort/);

assert.match(page, /pointsUsedForDisplay/);
assert.match(page, /memberLastPointsAt/);
assert.match(page, /members-col-earned/);
assert.match(page, /members-col-used/);
assert.match(page, /members-col-points-when/);
assert.match(page, /members-col-visits/);
assert.match(page, /members-col-source/);
assert.match(page, /members-col-signup/);
assert.match(page, /แต้มล่าสุด/);
assert.match(page, /formatSignupDay/);

assert.match(fn, /lifetimePointsRedeemedAfter/);
assert.match(fn, /lastPointsAt: now/);
assert.match(fn, /lifetimePointsRedeemed: 0/);
assert.match(fn, /lifetimeEarnVisits: visits \+ 1/);
assert.match(fn, /lifetimeEarnVisits: 0/);

// Display helper logic (mirror)
function pointsUsedForDisplay(m) {
  const redeemed = Math.max(0, Math.trunc(Number(m.lifetimePointsRedeemed) || 0));
  if (redeemed > 0) return redeemed;
  const earned = Math.max(0, Math.trunc(Number(m.lifetimePointsEarned) || 0));
  const bal = Math.max(0, Math.trunc(Number(m.pointsBalance) || 0));
  return Math.max(0, earned - bal);
}
assert.equal(pointsUsedForDisplay({ lifetimePointsRedeemed: 12, lifetimePointsEarned: 40, pointsBalance: 28 }), 12);
assert.equal(pointsUsedForDisplay({ lifetimePointsRedeemed: 0, lifetimePointsEarned: 40, pointsBalance: 28 }), 12);
assert.equal(pointsUsedForDisplay({ lifetimePointsRedeemed: 0, lifetimePointsEarned: 10, pointsBalance: 10 }), 0);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 809);

console.log("OK test-members-points-columns");
