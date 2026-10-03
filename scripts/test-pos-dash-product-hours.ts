/**
 * POS dashboard: product × hour heatmap data + card wiring.
 * Run: npx tsx scripts/test-pos-dash-product-hours.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bangkokHour,
  summarizePosProductHours,
  summarizePosSalesByHour,
} from "../src/lib/pos-sales-dashboard";
import type { MenuCategory, MenuItem, PosSale } from "../src/lib/types";

function intlHour(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value || "0") % 24;
}

// bangkokHour arithmetic must equal Intl for every hour across a year.
const start = Date.UTC(2026, 0, 1);
for (let ms = start; ms < start + 366 * 86_400_000; ms += 3_600_000 + 61_000) {
  assert.equal(bangkokHour(ms), intlHour(ms), new Date(ms).toISOString());
}
assert.equal(bangkokHour(0), 0);
assert.equal(bangkokHour(Number.NaN), 0);

/** Bangkok wall-clock ms for 2026-09-10 at hh:mm. */
const at = (hh: number, mm = 0) => Date.UTC(2026, 8, 10, hh - 7, mm);

type Line = { menuItemId?: string; name: string; price: number; qty: number };
const sale = (createdAt: number, lines: Line[], status = "completed") =>
  ({ id: String(createdAt) + Math.random(), status, createdAt, total: 0, lines }) as unknown as PosSale;

const cats = [
  { id: "ice", name: "ไอศกรีม" },
  { id: "tea", name: "ชา" },
] as unknown as MenuCategory[];
const items = [
  { id: "ic1", name: "ไอศกรีมวานิลลา", categoryId: "ice", active: true },
  { id: "ic2", name: "ไอศกรีมช็อก", categoryId: "ice", active: true },
  { id: "t1", name: "ชาไทย", categoryId: "tea", active: true },
] as unknown as MenuItem[];

const sales = [
  sale(at(14, 5), [{ menuItemId: "ic1", name: "ไอศกรีมวานิลลา", price: 30, qty: 3 }]),
  sale(at(14, 59), [{ name: "ไอศกรีมวานิลลา", price: 30, qty: 2 }]),
  sale(at(15, 0), [
    { menuItemId: "ic2", name: "ไอศกรีมช็อก", price: 30, qty: 1 },
    { menuItemId: "t1", name: "ชาไทย", price: 40, qty: 1 },
  ]),
  sale(at(8, 30), [{ menuItemId: "t1", name: "ชาไทย", price: 40, qty: 4 }]),
  sale(at(23, 30), [{ name: "ของแถมไม่มีในเมนู", price: 0, qty: 1 }]),
  sale(at(0, 10), [{ menuItemId: "t1", name: "ชาไทย", price: 40, qty: 1 }]),
  sale(at(12), [{ menuItemId: "t1", name: "ชาไทย", price: 40, qty: 99 }], "voided"),
  sale(at(12), [{ menuItemId: "t1", name: "ชาไทย", price: 40, qty: 0 }]),
];

const d = summarizePosProductHours(sales, items, cats);

const van = d.products.find((r) => r.key === "ic1");
assert.ok(van, "vanilla row");
assert.equal(van.qty, 5, "line without menuItemId merges by name");
assert.equal(van.byHour[14], 5, "14:05 and 14:59 both in hour 14");
assert.equal(van.peakHour, 14);
assert.equal(van.peakPct, 100);

const tea = d.products.find((r) => r.key === "t1");
assert.ok(tea);
assert.equal(tea.qty, 6, "voided and qty 0 ignored");
assert.equal(tea.byHour[8], 4);
assert.equal(tea.byHour[15], 1);
assert.equal(tea.byHour[0], 1, "00:10 is hour 0");
assert.equal(tea.peakHour, 8);
assert.equal(tea.byHour.length, 24);
assert.equal(tea.byHour.reduce((a, b) => a + b, 0), tea.qty, "hours sum to qty");

const ice = d.categories.find((r) => r.key === "ice");
assert.ok(ice);
assert.equal(ice.name, "ไอศกรีม");
assert.equal(ice.qty, 6);
assert.equal(ice.byHour[14], 5);
assert.equal(ice.byHour[15], 1);
assert.ok(d.categories.some((r) => r.key === "__other__" && r.byHour[23] === 1));

assert.equal(d.products[0].key, "t1", "sorted by qty desc");
assert.equal(d.firstHour, 0);
assert.equal(d.lastHour, 23);

// Totals agree with the existing hour chart's bill counts per hour.
const billHours = summarizePosSalesByHour(sales);
assert.equal(billHours[14].count, 2);

const empty = summarizePosProductHours([], items, cats);
assert.deepEqual(empty, { products: [], categories: [], firstHour: null, lastHour: null });

const card = readFileSync("src/components/PosSalesDashboardProductHours.tsx", "utf8");
assert.match(card, /POS_PRODUCT_HOURS_PREFS_KEY/);
assert.match(card, /type="checkbox"/);
assert.match(card, /"product" \| "category"/);
assert.match(card, /picked\[mode\] \?\? all\.slice\(0, POS_PRODUCT_HOURS_DEFAULT_TOP\)/);
assert.doesNotMatch(card, /unitCost|stockCosts|margin/i, "no cost data in this card");

const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
assert.match(dash, /<PosSalesDashboardProductHours data=\{productHours\} \/>/);

const css = readFileSync("src/app/globals.css", "utf8");
assert.match(css, /\.pos-ph-table \{[^}]*table-layout: fixed/);

console.log("test-pos-dash-product-hours: ok");
