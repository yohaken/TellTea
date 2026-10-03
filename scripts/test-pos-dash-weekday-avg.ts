/**
 * POS dashboard: weekday sales normalised by weekday count in range.
 * Run: npx tsx scripts/test-pos-dash-weekday-avg.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  summarizePosSalesByWeekday,
  summarizePosSalesByWeekdayAvg,
} from "../src/lib/pos-sales-dashboard";
import type { PosSale } from "../src/lib/types";

/** Bangkok midnight ms for 2026-MM-DD. */
const day = (m: number, d: number) => Date.UTC(2026, m - 1, d, -7);
/** Bangkok wall clock. */
const at = (m: number, d: number, hh: number, mm = 0) => Date.UTC(2026, m - 1, d, hh - 7, mm);
const sale = (m: number, d: number, hh: number, total: number, status = "completed") =>
  ({
    id: `${m}-${d}-${hh}-${Math.random()}`,
    status,
    date: day(m, d),
    createdAt: at(m, d, hh),
    total,
    lines: [],
  }) as unknown as PosSale;

// June 2026: 1 Jun = Monday → Mon/Tue ×5, Wed–Sun ×4 (30 days).
const june = { startMs: day(6, 1), endMs: day(6, 30) };
const now = at(7, 15, 12);
const sales: PosSale[] = [];
for (let d = 1; d <= 30; d++) sales.push(sale(6, d, 10, 100)); // flat 100/day
sales.push(sale(6, 7, 1, 50)); // Sun 7 Jun, late shift
sales.push(sale(6, 8, 20, 999, "voided"));
sales.push(sale(5, 31, 12, 777)); // outside range
sales.push(sale(7, 1, 12, 777)); // outside range

const r = summarizePosSalesByWeekdayAvg(sales, june, { nowMs: now });
const row = (wd: number) => r.rows.find((x) => x.weekday === wd)!;

assert.deepEqual(
  r.rows.map((x) => x.weekday),
  [1, 2, 3, 4, 5, 6, 0],
  "Mon → Sun order",
);
assert.equal(r.totalDays, 30);
assert.equal(row(1).days, 5);
assert.equal(row(2).days, 5);
assert.equal(row(0).days, 4);
assert.equal(r.rows.reduce((s, x) => s + x.days, 0), 30);
assert.equal(r.unequalDays, true);
assert.equal(r.cappedAtToday, false);

// Totals differ only because of weekday counts; averages are equal.
assert.equal(row(1).total, 500);
assert.equal(row(3).total, 400);
assert.equal(row(1).avgPerDay, 100);
assert.equal(row(3).avgPerDay, 100);
assert.equal(row(0).total, 450);
assert.equal(row(0).avgPerDay, 112.5);
assert.equal(row(0).bills, 5);
assert.equal(row(0).billsPerDay, 1.25);
assert.equal(row(0).avgBill, 90);
assert.ok(row(0).index > 100 && row(1).index < 100);
assert.deepEqual(
  row(0).dates.map((d) => d.label),
  ["07/06", "14/06", "21/06", "28/06"],
);
assert.equal(r.total, 3050);
assert.equal(r.avgPerDay, round2(3050 / 30));

// Totals match the legacy weekday chart (same day bucketing).
const legacy = summarizePosSalesByWeekday(sales.filter((s) => s.date >= june.startMs && s.date <= june.endMs));
for (const x of r.rows) assert.equal(x.total, legacy[x.weekday].total, `wd ${x.weekday}`);

// Band filter: late shift only → only the 01:00 sale on Sunday.
const late = summarizePosSalesByWeekdayAvg(sales, june, { nowMs: now, band: "late" });
assert.equal(late.total, 50);
assert.equal(late.rows.find((x) => x.weekday === 0)!.avgPerDay, 12.5);
assert.equal(late.rows.find((x) => x.weekday === 0)!.daysWithSales, 1);
assert.equal(late.totalDays, 30, "band filter keeps calendar days");
const morning = summarizePosSalesByWeekdayAvg(sales, june, { nowMs: now, band: "morning" });
assert.equal(morning.total, 3000);

// Equal weeks: 1–28 Jun → every weekday ×4.
const fourWeeks = summarizePosSalesByWeekdayAvg(sales, { startMs: day(6, 1), endMs: day(6, 28) }, { nowMs: now });
assert.equal(fourWeeks.unequalDays, false);
assert.ok(fourWeeks.rows.every((x) => x.days === 4));

// Range past today is capped; unfinished today left out (Wed 10 Jun).
const cur = summarizePosSalesByWeekdayAvg(
  [sale(6, 3, 9, 60), sale(6, 10, 9, 80)],
  { startMs: day(6, 1), endMs: day(6, 30) },
  { nowMs: at(6, 10, 15) },
);
assert.equal(cur.totalDays, 9);
assert.equal(cur.cappedAtToday, true);
assert.equal(cur.excludedToday, true);
const wed = cur.rows.find((x) => x.weekday === 3)!;
assert.equal(wed.days, 1);
assert.deepEqual(wed.dates.map((d) => d.label), ["03/06"]);
assert.equal(wed.avgPerDay, 60);
assert.equal(cur.total, 60, "today's sale not counted");
assert.equal(cur.rows.find((x) => x.weekday === 2)!.days, 2);
assert.equal(cur.unequalDays, true);

// Range = today only → today is kept and flagged.
const todayOnly = summarizePosSalesByWeekdayAvg(
  [sale(6, 10, 9, 80)],
  { startMs: day(6, 10), endMs: day(6, 10) },
  { nowMs: at(6, 10, 15) },
);
assert.equal(todayOnly.excludedToday, false);
assert.equal(todayOnly.totalDays, 1);
assert.equal(todayOnly.total, 80);
assert.equal(todayOnly.rows.find((x) => x.weekday === 3)!.dates[0].isToday, true);

// Range ending yesterday → nothing excluded.
const toYesterday = summarizePosSalesByWeekdayAvg(
  [],
  { startMs: day(6, 1), endMs: day(6, 9) },
  { nowMs: at(6, 10, 15) },
);
assert.equal(toYesterday.excludedToday, false);
assert.equal(toYesterday.totalDays, 9);

// Single day / future range / empty: no NaN.
const one = summarizePosSalesByWeekdayAvg([], { startMs: day(6, 3), endMs: day(6, 3) }, { nowMs: now });
assert.equal(one.totalDays, 1);
assert.equal(one.rows.filter((x) => x.days > 0).length, 1);
const future = summarizePosSalesByWeekdayAvg([], { startMs: day(8, 1), endMs: day(8, 5) }, { nowMs: now });
assert.equal(future.totalDays, 0);
for (const x of future.rows) {
  assert.ok(Number.isFinite(x.avgPerDay) && Number.isFinite(x.index));
}

// Wiring.
const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
assert.match(dash, /<PosSalesDashboardWeekdays sales=\{sales\} range=\{salesRange\} \/>/);
const card = readFileSync("src/components/PosSalesDashboardWeekdays.tsx", "utf8");
assert.match(card, /เฉลี่ย\/วัน/);
assert.match(card, /÷ \{r\.days\} วัน/);
assert.match(card, /นับจาก \{data\.totalDays\} วัน/);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

console.log("test-pos-dash-weekday-avg: ok");
