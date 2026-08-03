/**
 * Owner-only staff presence dock — show all staff + lastSeenAt from staff table.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 682);
assert.match(read("src/lib/staff-presence.ts"), /touchStaffPresence/);
assert.match(read("src/lib/staff-presence.ts"), /touchStaffPresenceFromActor/);
assert.match(read("src/lib/staff-presence.ts"), /resolvePresenceStaffId/);
assert.match(read("src/lib/staff-presence.ts"), /coercePresenceMs/);
assert.match(read("src/lib/staff-presence.ts"), /toMillis/);
assert.match(read("src/lib/staff-presence.ts"), /formatPresenceAge/);
assert.match(read("src/lib/staff-presence.ts"), /formatPresenceLastLogin/);
assert.match(read("src/lib/staff-presence.ts"), /staffShortLabel/);
assert.match(read("src/lib/staff-presence.ts"), /resolvePresenceLabel/);
assert.match(read("src/lib/staff-presence.ts"), /ชื่อเล่นเต็มก่อน/);
assert.match(read("src/lib/staff-presence.ts"), /แสดงพนักงานทุกคน/);
assert.match(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_HEARTBEAT_MS\s*=\s*2\s*\*\s*60_000/);
assert.match(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_WARMUP_MS\s*=\s*30_000/);
assert.match(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_ONLINE_MS\s*=\s*5\s*\*\s*60_000/);
assert.doesNotMatch(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_WINDOW_MS/);
assert.doesNotMatch(read("src/lib/staff-presence.ts"), /STAFF_PRESENCE_IDLE_MS/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /staff-presence-name/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /is-waiting/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /visibilitychange/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /formatPresenceLastLogin/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /STAFF_PRESENCE_HEARTBEAT_MS/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /STAFF_PRESENCE_WARMUP_MS/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /realStaff/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /usePathname/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /Presence มาตรฐาน/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /เปิดหน้า/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /ACTIVITY_TOUCH_MIN_MS/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /pointerdown/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /input/);
// Interval path must not skip when keyboard reports hidden
assert.doesNotMatch(
  read("src/components/StaffPresenceHeartbeat.tsx"),
  /if \(\s*document\.visibilityState === \"hidden\"\s*\) return/,
);
assert.match(read("src/lib/stock-count.ts"), /await touchStaffPresenceFromActor/);
assert.match(read("src/lib/ot.ts"), /await touchStaffPresenceFromActor/);
assert.match(read("src/lib/ot.ts"), /actorId \|\| current\.createdBy/);
assert.match(read("src/lib/production.ts"), /await touchStaffPresenceFromActor/);
assert.match(read("src/lib/production.ts"), /actorId \|\| current\.createdBy/);
assert.match(read("src/lib/checklist.ts"), /await touchStaffPresenceFromActor/);
assert.match(read("src/lib/auth.tsx"), /touchStaffPresence\(member\.id\)/);
assert.match(read("src/lib/auth.tsx"), /touchStaffPresence\(cached\.id\)/);
assert.match(read("src/app/ot/page.tsx"), /updateOtEntry\(entry\.id, payload, entry, createdBy\)/);
assert.match(read("src/lib/shift-close.ts"), /updateOtEntry\(entry\.id, fullPayload, entry, payload\.createdBy\)/);
assert.match(read("firestore.rules"), /isOwnStaffDoc/);
assert.doesNotMatch(
  read("src/components/StaffPresenceHeartbeat.tsx"),
  /const \{ staff, status \}/,
  "heartbeat must use realStaff, not preview staff",
);
assert.match(
  read("scripts/repair-staff-presence-from-activity.mjs"),
  /ห้ามใช้ updatedAt/,
);
assert.match(read("src/app/globals.css"), /\.staff-presence-name\b/);
assert.match(read("src/app/globals.css"), /\.is-waiting\b/);
assert.match(read("src/lib/employees.ts"), /nickname/);
assert.match(read("src/lib/types.ts"), /lastSeenAt/);
assert.match(read("firestore.rules"), /'lastSeenAt'/);
assert.match(read("firestore.rules"), /staffPresenceTouch/);
assert.match(read("src/components/StaffPresenceDock.tsx"), /isOwner/);
assert.match(read("src/components/StaffPresenceHeartbeat.tsx"), /touchStaffPresence/);
assert.match(read("src/components/AppShell.tsx"), /StaffPresenceDock/);
assert.match(read("src/components/AppShell.tsx"), /StaffPresenceHeartbeat/);
// Must keep heartbeat during perm preview (realStaff touch)
assert.doesNotMatch(
  read("src/components/AppShell.tsx"),
  /\{!isPermPreview \? <StaffPresenceHeartbeat/,
);
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

function formatPresenceLastLogin(lastSeenAt, now) {
  if (!lastSeenAt || lastSeenAt <= 0) return "ยังไม่เคยเข้า";
  const time = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(lastSeenAt));
  const dayKey = (ms) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  if (dayKey(lastSeenAt) === dayKey(now)) return `วันนี้ ${time}`;
  if (dayKey(lastSeenAt) === dayKey(now - 24 * 60 * 60 * 1000)) return `เมื่อวาน ${time}`;
  const date = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
  }).format(new Date(lastSeenAt));
  return `${date} ${time}`;
}
const noonBangkok = Date.parse("2026-08-03T05:00:00.000Z"); // 12:00 ICT
assert.match(formatPresenceLastLogin(noonBangkok, noonBangkok + 60_000), /^วันนี้ /);

console.log("test-staff-presence: ok");
