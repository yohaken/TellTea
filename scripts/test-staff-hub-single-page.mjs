/**
 * Staff hub — team / accounts / levels on one scroll page (no hide-tabs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 688);

const page = read("src/app/staff/page.tsx");
assert.match(page, /staff-hub-jump/);
assert.match(page, /href="#staff-team"/);
assert.match(page, /href="#staff-accounts"/);
assert.match(page, /href="#staff-levels"/);
assert.match(page, /StaffTeamMiniTable/);
assert.match(page, /บัญชีเข้าใช้/);
assert.match(page, /PermissionLevelsPanel/);
assert.match(page, /scrollIntoView/);
// Must not gate sections behind tab state
assert.doesNotMatch(page, /type HubTab/);
assert.doesNotMatch(page, /staff-hub-tabs/);
assert.doesNotMatch(page, /tab === "/);

const css = read("src/app/globals.css");
assert.match(css, /\.staff-hub-jump\b/);
assert.match(css, /\.staff-hub-anchor\b/);

console.log("test-staff-hub-single-page: ok");
