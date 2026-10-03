/**
 * POS dashboard: popular options card — paid vs free ranking + collapse wiring.
 * Run: npx tsx scripts/test-pos-dash-options.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isNoneOptionChoice, summarizePosSaleOptions } from "../src/lib/pos-sales-dashboard";
import type { PosSale, PosSaleLine, PosSaleLineOption } from "../src/lib/types";

const opt = (groupName: string, ...choices: Array<[string, number]>): PosSaleLineOption => ({
  groupId: groupName,
  groupName,
  choices: choices.map(([name, priceDelta]) => ({ optionId: name, name, priceDelta })),
});
const line = (qty: number, options?: PosSaleLineOption[]): PosSaleLine => ({
  menuItemId: "m",
  name: "ชาไทย",
  price: 40,
  qty,
  options,
});
const sale = (lines: PosSaleLine[], status = "completed") =>
  ({ id: Math.random().toString(36), status, createdAt: 1, total: 0, lines }) as unknown as PosSale;

const sales = [
  sale([
    line(2, [opt("ความหวาน", ["หวานน้อย 50%", 0]), opt("ท้อปปิ้ง", ["ไข่มุก", 5])]),
    line(1, [opt("ความหวาน", ["หวานปกติ 100%", 0]), opt("ท้อปปิ้ง", ["ไม่เพิ่ม", 0])]),
  ]),
  sale([
    // ไข่มุก ×2 on one cup → picks 2, cups 1
    line(1, [opt("ท้อปปิ้ง", ["ไข่มุก", 5], ["ไข่มุก", 5]), opt("ความหวาน", ["หวานน้อย 50%", 0])]),
    line(1, [opt("ประเภท", ["ปั่น สูตรเข้ม", 10])]),
    line(3),
    line(0, [opt("ท้อปปิ้ง", ["ชีส", 20])]),
    line(1, [opt("  ท้อปปิ้ง ", ["  ", 5])]),
  ]),
  sale([line(5, [opt("ท้อปปิ้ง", ["ชีส", 20])])], "voided"),
  // same choice name, price changed to free → separate row in free list
  sale([line(1, [opt("ท้อปปิ้ง", ["ไข่มุก", 0])])]),
];

const s = summarizePosSaleOptions(sales);

assert.equal(s.totalCups, 2 + 1 + 1 + 1 + 3 + 1 + 1, "units of completed lines with qty > 0");
assert.equal(s.cupsWithOption, 2 + 1 + 1 + 1 + 1, "line(3) with no options and blank-name choice excluded");
assert.equal(s.cupsWithPaidOption, 2 + 1 + 1);

const pearl = s.paid.find((r) => r.name === "ไข่มุก");
assert.ok(pearl);
assert.equal(pearl.qty, 4, "2 cups ×1 + 1 cup ×2");
assert.equal(pearl.cups, 3);
assert.equal(pearl.revenue, 20);
assert.equal(pearl.avgPrice, 5);
assert.equal(pearl.groupName, "ท้อปปิ้ง");

const blend = s.paid.find((r) => r.name === "ปั่น สูตรเข้ม");
assert.ok(blend);
assert.equal(blend.revenue, 10);

assert.equal(s.paidRevenue, 30);
assert.equal(s.paidPicks, 5);
assert.ok(!s.paid.some((r) => r.name === "ชีส"), "voided + qty 0 ignored");
assert.equal(s.paid[0].name, "ไข่มุก", "paid sorted by picks");

const freePearl = s.free.find((r) => r.name === "ไข่มุก");
assert.ok(freePearl, "free version of same choice is its own row");
assert.equal(freePearl.qty, 1);

const less = s.free.find((r) => r.name === "หวานน้อย 50%");
assert.ok(less);
assert.equal(less.qty, 3);
assert.equal(less.groupSharePct, 75, "3 of 4 sweetness picks");
assert.equal(s.free[0].name, "หวานน้อย 50%");

// ท้อปปิ้ง picks: ไข่มุก paid 4 + ไม่เพิ่ม 1 + ไข่มุก free 1 = 6
const none = s.free.find((r) => r.name === "ไม่เพิ่ม");
assert.ok(none);
assert.equal(none.groupSharePct, Math.round((1 / 6) * 10000) / 100);
assert.equal(pearl.attachPct, Math.round((3 / s.totalCups) * 10000) / 100);

assert.deepEqual(s.groups.slice(0, 2), ["ท้อปปิ้ง", "ความหวาน"]);
assert.equal(s.freePicks + s.paidPicks, [...s.free, ...s.paid].reduce((a, r) => a + r.qty, 0));

assert.ok(isNoneOptionChoice("ไม่เพิ่ม"));
assert.ok(isNoneOptionChoice(" ไม่เพิ่ม ต้นตำรับ"));
assert.ok(!isNoneOptionChoice("ไม่หวาน 0%"));

const empty = summarizePosSaleOptions([]);
assert.equal(empty.totalCups, 0);
assert.deepEqual(empty.paid, []);

// Many options → collapse at 20
const many = summarizePosSaleOptions([
  sale(
    Array.from({ length: 25 }, (_, i) =>
      line(i + 1, [opt("ท้อปปิ้ง", [`t${String(i).padStart(2, "0")}`, 5])]),
    ),
  ),
]);
assert.equal(many.paid.length, 25);
assert.equal(many.paid[0].name, "t24");

const card = readFileSync("src/components/PosSalesDashboardOptions.tsx", "utf8");
assert.match(card, /POS_DASH_OPTIONS_COLLAPSED = 20/);
assert.match(card, /title="คิดเงิน"/);
assert.match(card, /title="ไม่คิดเงิน"/);
assert.match(card, /aria-expanded/);
assert.match(card, /ย่อเหลือ/);
assert.doesNotMatch(card, /unitCost|stockCosts|margin/i);

const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
assert.match(dash, /<PosSalesDashboardOptions options=\{saleOptions\} \/>/);
assert.match(dash, /summarizePosSaleOptions\(sales\)/);

console.log("test-pos-dash-options: ok");
