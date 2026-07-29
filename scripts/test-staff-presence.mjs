/**
 * Owner-only staff presence dock — show all staff + lastSeenAt from staff table.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD\s*=\s*399\b/);
assert.match(read("src/lib/staff-presence.ts"), /touchStaffPresence/);
assert.match(read("src/lib/staff-presence.ts"), /formatPresenceAge/);
assert.match(read("src/lib/staff-presence.ts"), /staffShortLabel/);
assert.match(read("src/lib/staff-presence.ts"), /resolvePresenceLabel/);
assert.match(read("src/lib/staff-presence.ts"), /ชื่อเล่นเต็มก่อน/);
assert.match(read("src/lib/staff-presence.ts"), /แสดงพนักงานทุกคน/);
assert.match(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_HEARTBEAT_MS\s*=\s*10\s*\*\s*60_000/);
assert.doesNotMatch(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_WINDOW_MS/);
assert.doesNotMatch(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_IDLE_MS/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /staff-presence-name/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /is-waiting/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /visibilitychange/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /STAFF_PRESENCE_HEARTBEAT_MS/);
assert.match(read("src/app/globals.css"), /\.staff-presence-name\b/);
assert.match(read("src/app/globals.css"), /\.is-waiting\b/);
assert.match(read("src/lib/employees.ts"), /nickname/);
assert.match(read("src/lib/types.ts"), /lastSeenAt/);
assert.match(read("firestore.rules"), /'lastSeenAt'/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /isOwner/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /touchStaffPresence/);
assert.match(read("src/components/AppShell.tsx"), /StaffPresenceDock/);
assert.match(read("src/components/AppShell.tsx"), /StaffPresenceHeartbeat/);
assert.match(read("src/app/staff/page.tsx"), /ชื่อเล่น/);
assert.match(read("src/app/staff/page.tsx"), /แก้ชื่อ/);
assert.match(read("src/components/StaffReadinessTable.tsx"), /staff-ready-col-nick/);
assert.match(read("src/app/globals.css"), /\.staff-presence-dock\b/);

// unit: sort shows never-seen last; age formatting
function buildItems(members) {
  return members
    .filter((m) => m.role === "staff")
    .map((m) => ({
      staffId: m.id,
      lastSeenAt: m.lastSeenAt || 0,
      label: m.label,
    }))
    .sort((a, b) => {
      if (a.lastSeenAt !== b.lastSeenAt) {
        if (!a.lastSeenAt) return 1;
        if (!b.lastSeenAt) return -1;
        return b.lastSeenAt - a.lastSeenAt;
      }
      return a.label.localeCompare(b.label, "th");
    });
}
const sorted = buildItems([
  { id: "a", role: "staff", label: "เอ", lastSeenAt: 0 },
  { id: "b", role: "staff", label: "บี", lastSeenAt: 100 },
  { id: "c", role: "staff", label: "ซี", lastSeenAt: 200 },
  { id: "o", role: "owner", label: "เจ้าของ" },
]);
assert.deepEqual(
  sorted.map((x) => x.staffId),
  ["c", "b", "a"],
);

function formatPresenceAge(lastSeenAt, now) {
  if (!lastSeenAt || lastSeenAt <= 0) return "—";
  const sec = Math.max(0, Math.floor((now - lastSeenAt) / 1000));
  if (sec < 60) return "เมื่อกี้";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}น`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}ช`;
  return `${Math.floor(hr / 24)}ว`;
}
assert.equal(formatPresenceAge(0, Date.now()), "—");
assert.equal(formatPresenceAge(Date.now() - 55 * 60_000, Date.now()), "55น");

console.log("test-staff-presence: ok");
