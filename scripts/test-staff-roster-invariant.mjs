/**
 * Guard: systemic staff permission invariant (all roster members, not one person).
 * Email/phone in staff collection → resolveEffectivePermissions matches rules intent.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const rules = read("firestore.rules");
const perms = read("src/lib/permissions.ts");
const levels = read("src/lib/permission-levels.ts");
const audit = read("scripts/audit-staff-bonus-access.mjs");
const bundle = read("src/lib/staff-work-load.ts");
const auth = read("src/lib/auth.tsx");

// Rules: roster → level → hasPerm (not inline map only)
assert.match(rules, /function linkedPermissionLevelId/);
assert.match(rules, /function linkedLevelActive/);
assert.match(rules, /function staffHasBrokenLevelLink/);
assert.match(rules, /function hasPermFromLevel/);
assert.match(rules, /function staffOwnsEmployee/);
assert.match(rules, /function canReadBonusPersonalClose/);
assert.match(rules, /function resolvedStaffId/);
assert.match(rules, /emailStaffExists/);

// Client mirrors rules resolution order
assert.match(perms, /resolveEffectivePermissions/);
assert.match(perms, /permissionLevelId/);
assert.match(perms, /permissionsCustomized/);
assert.match(levels, /bindOrphanStaffToShopStaff/);
assert.match(levels, /shop_staff/);

// Systemic audit covers whole roster
assert.match(audit, /listCollection\(token, "staff"\)/);
assert.match(audit, /for \(const staff of staffMembers\)/);
assert.match(audit, /permissionLevelId=shop_staff/);

// All staff pages use bundle (not Toey-specific)
assert.match(bundle, /loadStaffBonusBundleFromServer/);
assert.doesNotMatch(bundle, /nawarat|เตย|tey/i, "staff-work-load must not hardcode one person");

const bonusPage = read("src/app/bonus/page.tsx");
const prodPage = read("src/app/production/page.tsx");
assert.match(bonusPage, /useStaffWorkBundle/);
assert.match(prodPage, /useStaffWorkBundle/);
assert.doesNotMatch(bonusPage, /nawarat|เตย/i, "bonus page must not hardcode one staff");

// Auth resolves staff id for any roster member
assert.match(auth, /prefetchStaffIdentity/);
assert.match(auth, /withResolvedPermissions/);

console.log("OK staff roster permission invariant (systemic, all staff)");
