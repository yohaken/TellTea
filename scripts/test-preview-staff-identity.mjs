/**
 * Guard: perm preview must impersonate the staff member's identity
 * so production/OT "mine" filters resolve the same worker as a real login.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const preview = read("src/lib/perm-preview.ts");
assert.match(preview, /const memberId = \(preview\.memberId \|\| ""\)\.trim\(\)/);
assert.match(preview, /id:\s*memberId \|\| real\.id/);
assert.match(preview, /resolvedEmployeeId/);
assert.match(preview, /memberId:\s*member\.id/);

const presence = read("src/lib/staff-presence.ts");
assert.match(presence, /permissionLevelId/);
assert.match(presence, /permissionsCustomized/);

const dock = read("src/components/StaffPresenceDock.tsx");
assert.match(dock, /findEmployeeForPresence/);
assert.match(dock, /previewFromMember\(\s*member,\s*item\.fullName/);

const prod = read("src/app/production/page.tsx");
assert.match(prod, /resolveMyWorkerId/);
assert.doesNotMatch(
  prod,
  /staff\?\.employeeId\s*\|\|\s*resolveLinkedEmployee/,
  "prefer resolveMyWorkerId so stale employeeId cannot blank the list",
);

const ot = read("src/app/ot/page.tsx");
assert.match(ot, /resolveMyWorkerId/);

const employees = read("src/lib/employees.ts");
assert.match(employees, /export function resolveMyWorkerId/);
assert.match(employees, /nickname/);

console.log("OK test-preview-staff-identity");
