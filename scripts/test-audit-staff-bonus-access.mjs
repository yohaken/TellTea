/**
 * Guard: staff bonus/access audit script exists and mirrors resolveEffectivePermissions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "scripts/audit-staff-bonus-access.mjs"), "utf8");

assert.match(src, /resolveEffectivePermissions/);
assert.match(src, /resolveLinkedEmployee/);
assert.match(src, /otBonus/);
assert.match(src, /linkedStaffId/);
assert.match(src, /APPLY/);
assert.match(src, /mypeer-501909/);

console.log("OK test-audit-staff-bonus-access");
