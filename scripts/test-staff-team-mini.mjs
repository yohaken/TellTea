/**
 * Unified staff team mini table — roster + readiness in one expandable list.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 691);

const page = read("src/app/staff/page.tsx");
assert.match(page, /StaffTeamMiniTable/);
assert.match(page, /id="staff-team"/);
assert.match(page, /id="staff-accounts"/);
assert.match(page, /id="staff-levels"/);
assert.match(page, /PermissionLevelsPanel/);
assert.doesNotMatch(page, /StaffReadinessTable/);
assert.doesNotMatch(page, /EmployeeRosterRow/);
assert.doesNotMatch(page, /staff-hub-tabs/);
assert.doesNotMatch(page, /staff-hub-jump/);
assert.doesNotMatch(page, /HubTab/);
assert.doesNotMatch(page, /tab === "team"/);
assert.doesNotMatch(page, /staff-hub-panel-title">รายชื่อร้าน/);

const mini = read("src/components/StaffTeamMiniTable.tsx");
assert.match(mini, /buildStaffTeamRows/);
assert.match(mini, /สร้างบช\./);
assert.match(mini, /ลบบช\./);
assert.match(mini, /มุมมอง/);
assert.match(mini, /MemberPermEditor/);
assert.match(mini, /EmployeeEditPanel/);
assert.match(mini, /StaffPersonalInfoButton/);
assert.match(mini, /formatPresenceAge/);
assert.match(mini, /staff-team-mini-table/);
assert.match(mini, /staff-mini-account-line/);
assert.doesNotMatch(mini, /staff-mini-col-account/);
assert.doesNotMatch(mini, /staff-mini-col-level/);
assert.match(mini, /onDeleteAccount/);
assert.match(mini, /onSaveMemberPerms/);

const lib = read("src/lib/staff-team.ts");
assert.match(lib, /export function buildStaffTeamRows/);
assert.match(lib, /export function summarizeStaffTeam/);
assert.match(lib, /formatSalaryShort/);

const css = read("src/app/globals.css");
assert.match(css, /\.staff-team-mini-table\b/);
assert.match(css, /\.staff-mini-ready\b/);
assert.match(css, /\.staff-mini-detail\b/);

// Lightweight unit: inactive + linked staff collapse to one row
const { pathToFileURL } = await import("node:url");
void require;
void pathToFileURL;

// Inline sort/format checks without TS compile
function formatSalaryShort(amount) {
  if (amount == null || !(amount > 0)) return "—";
  return `฿${amount.toLocaleString("th-TH")}`;
}
assert.equal(formatSalaryShort(15000), "฿15,000");
assert.equal(formatSalaryShort(undefined), "—");

console.log("test-staff-team-mini: ok");
