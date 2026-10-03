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

// Member box sits at the end of the page (after products/stock) and owns the points block.
// Render order comes from pos-dash-layout default order (owner can drag to change).
const layout = read("src/lib/pos-dash-layout.ts");
const defaultIds = [...layout.matchAll(/\{ id: "(\w+)", label:/g)].map((m) => m[1]);
assert.equal(defaultIds.at(-1), "void", "void bills is the very last card by default");
assert.equal(defaultIds.at(-2), "members", "members right before void");
for (const id of ["products", "stock", "stats", "activity"]) {
  assert.ok(defaultIds.indexOf(id) < defaultIds.indexOf("members"), `members after ${id}`);
}
assert.equal(dash.split("<PosSalesDashboardMembers").length - 1, 1);
assert.match(dash, /members: \(\s*<PosSalesDashboardMembers/);
assert.match(dash, /void: \(\s*<article className="pos-dash-card pos-dash-card--void">/);
assert.doesNotMatch(dash, /pos-dash-card-title">แต้มสมาชิก/);
for (const p of ["totalBills", "totalSales", "pointsEarned", "pointsRedeemed", "redeemBaht", "redeemBillCount"]) {
  assert.match(ui, new RegExp(`${p}:`), p);
}
assert.match(ui, /การซื้อของสมาชิก/);
assert.match(ui, /แต้มสมาชิก/);
// Super-compact: one card, slim rows, chart folded by default.
assert.equal(ui.split("<article").length - 1, 1);
assert.match(ui, /useState\(false\)/);
assert.match(ui, /aria-expanded=\{showChart\}/);
assert.equal(ui.split('className="pos-dash-mem-col"').length - 1, 3);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-dash-mem-grid/);
assert.doesNotMatch(css, /\.pos-dash-member-stats/);
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
