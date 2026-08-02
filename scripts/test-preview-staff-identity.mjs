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
// Remaining OT gap: must carry target email/phone (not clear them) for linkedEmail match
assert.match(preview, /email:\s*member\.email/);
assert.match(preview, /phone:\s*member\.phone/);
assert.match(preview, /email: memberId \? preview\.email : real\.email/);
assert.match(preview, /phone: memberId \? preview\.phone : real\.phone/);
assert.match(preview, /permissionsCustomized: preview\.permissionsCustomized === true/);
assert.doesNotMatch(
  preview,
  /email: memberId \? undefined : real\.email/,
  "clearing email breaks resolveLinkedEmployee for preview",
);

const presence = read("src/lib/staff-presence.ts");
assert.match(presence, /permissionLevelId/);
assert.match(presence, /permissionsCustomized/);
assert.match(presence, /resolveLinkedEmployee/);
assert.match(
  presence,
  /return resolveLinkedEmployee\(employees, member\)/,
  "dock must resolve employee via email/phone/name like real login",
);

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
assert.match(ot, /resolveMyWorkerId|resolveLinkedEmployee/);
assert.match(ot, /entryIncludesMe/);
assert.match(ot, /\{ since, until \}/);
assert.doesNotMatch(
  ot,
  /workerId: filterId/,
  "OT staff view filters client-side so legacy name rows and preview identity still show the date grid",
);
assert.match(ot, /readOnly=\{!canWrite\}/);
assert.match(ot, /พรีวิวมุมพนักงาน/);

const employees = read("src/lib/employees.ts");
assert.match(employees, /export function resolveMyWorkerId/);
assert.match(employees, /nickname/);

console.log("OK test-preview-staff-identity");
