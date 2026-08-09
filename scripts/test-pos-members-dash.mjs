/**
 * Gate: POS sales dashboard — member signup/cumulative + points/cash copy.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 765);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)?.[1] || 0) >= 202);

assert.ok(existsSync(join(root, "src/components/PosSalesDashboardMembers.tsx")));

const membersLib = read("src/lib/members.ts");
assert.match(membersLib, /subscribeMembersCreatedThrough/);
assert.match(membersLib, /createdAt", "</);

const agg = read("src/lib/pos-sales-dashboard.ts");
assert.match(agg, /summarizeMemberGrowth/);
assert.match(agg, /summarizeMemberSalesTouch/);
assert.match(agg, /posRangeUntilExclusiveMs/);
assert.match(agg, /cumulativeStart|cumulativeEnd|signupsInRange|netChange/);

const ui = read("src/components/PosSalesDashboardMembers.tsx");
assert.match(ui, /สมัครใหม่ในช่วง/);
assert.match(ui, /สมาชิกสะสมปลายช่วง/);
assert.match(ui, /สมัครรายวัน · สะสม/);
assert.match(ui, /บิลผูกสมาชิก/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /PosSalesDashboardMembers/);
assert.match(dash, /subscribeMembersCreatedThrough/);
assert.match(dash, /ยอดรับเงินจริง/);
assert.match(dash, /ไม่ใช่ยอดขายบวกแต้ม/);
assert.match(dash, /แลกแต้มไม่เข้าเงินสด/);
assert.match(dash, /ไม่เข้าลิ้นชัก/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-dash-member-stats/);
assert.match(css, /\.pos-dash-member-bar/);
assert.match(css, /\.pos-dash-member-line/);

// Pure formula checks (mirror summarizeMemberGrowth — avoid Firebase imports).
function startOfLocalDay(ms) {
  const d = new Date(ms);
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return new Date(`${key}T00:00:00+07:00`).getTime();
}
function bangkokDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

const day = 24 * 60 * 60 * 1000;
const startMs = startOfLocalDay(Date.parse("2026-08-01T12:00:00+07:00"));
const endMs = startOfLocalDay(Date.parse("2026-08-03T12:00:00+07:00"));
const members = [
  { createdAt: startMs - day, status: "active" }, // before
  { createdAt: startMs + 1000, status: "active" }, // day1
  { createdAt: startMs + day + 1000, status: "active" }, // day2
  { createdAt: startMs + day + 2000, status: "deleted" }, // ignored by subscribe filter; keep out
  { createdAt: startMs + 2 * day + 1000, status: "suspended" }, // day3 counts
];
const active = members.filter((m) => m.status !== "deleted");
let cumulativeStart = active.filter((m) => m.createdAt < startMs).length;
assert.equal(cumulativeStart, 1);
const byDay = [];
for (let ms = startMs; ms <= endMs; ms += day) {
  const dateMs = startOfLocalDay(ms);
  const dateKey = bangkokDateKey(dateMs);
  const until = dateMs + day;
  const signups = active.filter((m) => m.createdAt >= dateMs && m.createdAt < until).length;
  cumulativeStart += signups;
  byDay.push({ dateKey, signups, cumulative: cumulativeStart });
}
assert.equal(byDay[0].signups, 1);
assert.equal(byDay[1].signups, 1);
assert.equal(byDay[2].signups, 1);
assert.equal(byDay[2].cumulative, 4);

console.log("OK test-pos-members-dash");
