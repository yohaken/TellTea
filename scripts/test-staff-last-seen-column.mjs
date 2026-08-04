/**
 * Staff readiness table — column ใช้ล่าสุด from staff.lastSeenAt
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 685);

const readiness = read("src/lib/staff-readiness.ts");
assert.match(readiness, /lastSeenAt\?:/);
assert.match(readiness, /member\.lastSeenAt/);

const table = read("src/components/StaffReadinessTable.tsx");
assert.match(table, /ใช้ล่าสุด/);
assert.match(table, /LastSeenCell/);
assert.match(table, /formatPresenceAge/);
assert.match(table, /formatPresenceLastLogin/);
assert.match(table, /STAFF_PRESENCE_ONLINE_MS/);
assert.match(table, /staff-ready-col-seen/);
assert.match(table, /กำลังใช้งาน/);

const css = read("src/app/globals.css");
assert.match(css, /\.staff-ready-col-seen\b/);
assert.match(css, /\.staff-ready-seen\b/);

// Must not couple this column to OT/stock write paths
assert.doesNotMatch(table, /otEntries|stockCount|touchStaffPresenceFromActor/);

console.log("test-staff-last-seen-column: ok");
