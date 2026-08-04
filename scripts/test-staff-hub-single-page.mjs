/**
 * Staff hub — one scroll page; no jump tabs; account folded into team expand.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 690);

const page = read("src/app/staff/page.tsx");
assert.match(page, /id="staff-team"/);
assert.match(page, /id="staff-accounts"/);
assert.match(page, /id="staff-levels"/);
assert.match(page, /StaffTeamMiniTable/);
assert.match(page, /สร้างบัญชี/);
assert.match(page, /PermissionLevelsPanel/);
assert.match(page, /onDeleteAccount/);
assert.match(page, /onPreviewMember/);
assert.match(page, /onSaveMemberPerms/);
assert.doesNotMatch(page, /staff-account-row/);
assert.doesNotMatch(page, /function MemberPermEditor/);
assert.doesNotMatch(page, /staff-hub-jump/);
assert.doesNotMatch(page, /type HubTab/);
assert.doesNotMatch(page, /staff-hub-tabs/);
assert.doesNotMatch(page, /tab === "/);

const mini = read("src/components/StaffTeamMiniTable.tsx");
assert.match(mini, /staff-mini-account-line/);
assert.doesNotMatch(mini, /staff-mini-col-account/);
assert.match(mini, /เงินเดือน/);
assert.match(mini, /ลบบช\./);
assert.match(mini, /มุมมอง/);

const team = read("src/lib/staff-team.ts");
assert.match(team, /เงินเดือนเต็ม/);
assert.doesNotMatch(team, /฿\$\{\(amount \/ 1000\)/);

const css = read("src/app/globals.css");
assert.match(css, /\.staff-hub-anchor\b/);
assert.doesNotMatch(css, /\.staff-hub-jump\b/);

console.log("test-staff-hub-single-page: ok");
