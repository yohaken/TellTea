/**
 * Staff last-seen column — now on unified team mini table from staff.lastSeenAt
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 688);

const readiness = read("src/lib/staff-readiness.ts");
assert.match(readiness, /lastSeenAt\?:/);
assert.match(readiness, /member\.lastSeenAt/);

const team = read("src/lib/staff-team.ts");
assert.match(team, /lastSeenAt/);

const table = read("src/components/StaffTeamMiniTable.tsx");
assert.match(table, /LastSeenMini/);
assert.match(table, /formatPresenceAge/);
assert.match(table, /formatPresenceLastLogin/);
assert.match(table, /STAFF_PRESENCE_ONLINE_MS/);
assert.match(table, /staff-mini-seen/);
assert.match(table, /กำลังใช้งาน/);

const css = read("src/app/globals.css");
assert.match(css, /\.staff-mini-seen\b/);
assert.match(css, /\.staff-mini-seen\.is-online/);

// Must not couple this column to OT/stock write paths
assert.doesNotMatch(table, /otEntries|stockCount|touchStaffPresenceFromActor/);

console.log("test-staff-last-seen-column: ok");
