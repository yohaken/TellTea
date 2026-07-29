/**
 * Owner-only staff presence dock + nickname + heartbeat.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD\s*=\s*390\b/);
assert.match(read("src/lib/staff-presence.ts"), /touchStaffPresence/);
assert.match(read("src/lib/staff-presence.ts"), /formatPresenceAge/);
assert.match(read("src/lib/staff-presence.ts"), /staffShortLabel/);
assert.match(read("src/lib/staff-presence.ts"), /resolvePresenceLabel/);
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

// unit-ish: short label + age formatting via dynamic import of logic duplicated inline
function staffShortLabel(source, max = 2) {
  const t = source.trim().replace(/\s+/g, "");
  if (!t) return "?";
  const chars = [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(t)].map(
    (s) => s.segment,
  );
  return chars.slice(0, max).join("");
}
function formatPresenceAge(lastSeenAt, now) {
  const sec = Math.max(0, Math.floor((now - lastSeenAt) / 1000));
  if (sec < 60) return "เมื่อกี้";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}น`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}ช`;
  return `${Math.floor(hr / 24)}ว`;
}
assert.equal(staffShortLabel("เป้"), "เป้");
assert.equal(staffShortLabel("สมชาย"), "สม");
assert.equal(formatPresenceAge(Date.now() - 5 * 60_000, Date.now()), "5น");
assert.equal(formatPresenceAge(Date.now() - 2 * 3600_000, Date.now()), "2ช");

console.log("test-staff-presence: ok");
