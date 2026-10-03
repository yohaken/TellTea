/**
 * POS dashboard: sales totals by shift band + hour.
 * Run: npx tsx scripts/test-pos-dash-time-totals.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POS_DASH_TIME_BANDS,
  summarizePosSalesByHour,
  summarizePosSalesByTimeBand,
} from "../src/lib/pos-sales-dashboard";
import type { PosSale } from "../src/lib/types";

const at = (day: number, hh: number, mm = 0) => Date.UTC(2026, 8, day, hh - 7, mm);
const sale = (createdAt: number, total: number, qtys: number[], status = "completed") =>
  ({
    id: `${createdAt}-${Math.random()}`,
    status,
    createdAt,
    total,
    lines: qtys.map((qty, i) => ({ name: `x${i}`, price: 10, qty })),
  }) as unknown as PosSale;

// Bands cover all 24 hours exactly once.
const covered = POS_DASH_TIME_BANDS.flatMap((b) => b.hours).sort((a, b) => a - b);
assert.deepEqual(covered, Array.from({ length: 24 }, (_, i) => i));

const sales = [
  sale(at(10, 6, 59), 50, [1]), // ดึก (edge before 07)
  sale(at(10, 7, 0), 100, [2]), // เช้า start
  sale(at(10, 16, 59), 60, [1, 1]), // เช้า end
  sale(at(10, 17, 0), 200, [3]), // เย็น start
  sale(at(10, 23, 59), 90.5, [1]), // เย็น end
  sale(at(11, 0, 0), 40, [1]), // ดึก midnight
  sale(at(11, 1, 30), 120, [2]), // ดึก
  sale(at(11, 1, 45), 30, [1]), // ดึก same hour
  sale(at(11, 12, 0), 999, [5], "voided"), // excluded
  sale(at(11, 12, 0), 0, [1]), // free bill counted as bill, 0 baht
  sale(at(11, 13, 0), 10, [Number.NaN, -1, 2]), // bad qtys ignored
];

const r = summarizePosSalesByTimeBand(sales, 2);
const band = (id: string) => r.bands.find((b) => b.id === id)!;

assert.deepEqual(
  r.bands.map((b) => b.id),
  ["morning", "evening", "late"],
);
assert.equal(band("morning").total, 170);
assert.equal(band("morning").bills, 4);
assert.equal(band("morning").units, 7);
assert.equal(band("morning").peakHour, 7);
assert.equal(band("evening").total, 290.5);
assert.equal(band("evening").bills, 2);
assert.equal(band("evening").peakHour, 17);
assert.equal(band("late").total, 240);
assert.equal(band("late").bills, 4);
assert.equal(band("late").units, 5);
assert.equal(band("late").peakHour, 1);
assert.equal(band("late").avgBill, 60);
assert.equal(band("late").perDay, 120);

assert.equal(r.grand.total, 700.5);
assert.equal(r.grand.bills, 10);
assert.equal(r.grand.units, 16);
assert.equal(r.grand.pct, 100);
assert.equal(r.grand.perDay, 350.25);
assert.equal(r.grand.avgBill, 70.05);

// Bands and hours reconcile with the grand total.
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
assert.equal(sum(r.bands.map((b) => b.total)), r.grand.total);
assert.equal(sum(r.hours.map((h) => h.total)), r.grand.total);
assert.equal(
  r.bands.reduce((s, b) => s + b.bills, 0),
  r.grand.bills,
);
assert.ok(Math.abs(sum(r.bands.map((b) => b.pct)) - 100) < 0.2);

// Hour rows agree with the existing hour chart.
const legacy = summarizePosSalesByHour(sales);
for (const h of r.hours) {
  assert.equal(h.total, legacy[h.hour].total, `hour ${h.hour}`);
  assert.equal(h.bills, legacy[h.hour].count, `hour ${h.hour} bills`);
}
assert.equal(r.hours[1].bills, 2);
assert.equal(r.hours[1].label, "01:00");

// No dayCount → perDay 0; empty input → zeros, no NaN.
assert.equal(summarizePosSalesByTimeBand(sales).grand.perDay, 0);
const empty = summarizePosSalesByTimeBand([], 7);
assert.equal(empty.grand.total, 0);
assert.equal(empty.grand.pct, 0);
for (const b of empty.bands) {
  assert.equal(b.peakHour, null);
  assert.ok(Number.isFinite(b.pct) && Number.isFinite(b.avgBill));
}

// Wiring.
const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
assert.match(dash, /summarizePosSalesByTimeBand\(sales, salesDayCount\)/);
assert.match(dash, /<PosSalesDashboardTimeTotals data=\{timeTotals\} dayCount=\{salesDayCount\} \/>/);
const card = readFileSync("src/components/PosSalesDashboardTimeTotals.tsx", "utf8");
assert.match(card, /ยอดขายรวมตามช่วงเวลา/);
assert.match(card, /ดูรายชั่วโมง/);
assert.match(card, /aria-expanded/);

console.log("test-pos-dash-time-totals: ok");
