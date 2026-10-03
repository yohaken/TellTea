/**
 * POS dashboard products card: full sorted list + 20-row collapse + menu join.
 * Run: npx tsx scripts/test-pos-dash-products.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  filterPosDashProducts,
  sumPosDashProducts,
  summarizePosSalesProducts,
} from "../src/lib/pos-sales-dashboard";
import type { MenuCategory, MenuItem, PosSale } from "../src/lib/types";

type Line = { menuItemId?: string; name: string; price: number; qty: number };

function sale(lines: Line[], status = "completed"): PosSale {
  return { id: Math.random().toString(36), status, lines } as unknown as PosSale;
}

const cats = [
  { id: "c1", name: "ชา" },
  { id: "c2", name: "กาแฟ" },
] as unknown as MenuCategory[];

const items: MenuItem[] = [];
for (let i = 1; i <= 30; i += 1) {
  items.push({
    id: `m${i}`,
    name: `เมนู ${i}`,
    categoryId: i % 2 ? "c1" : "c2",
    active: i !== 30,
  } as unknown as MenuItem);
}

const lines: Line[] = items.map((it, idx) => ({
  menuItemId: it.id,
  name: it.name,
  price: 10 * (idx + 1),
  qty: 1,
}));
const sales = [sale(lines), sale([{ name: "เมนู 1", price: 10, qty: 2 }]), sale(lines, "voided")];

const s = summarizePosSalesProducts(sales, items, cats, 20);

assert.equal(s.allItems.length, 30, "allItems lists every sold product");
assert.equal(s.topItems.length, 20, "topItems capped at topN");
assert.deepEqual(
  s.topItems.map((r) => r.menuItemId),
  s.allItems.slice(0, 20).map((r) => r.menuItemId),
  "topItems is prefix of allItems",
);
for (let i = 1; i < s.allItems.length; i += 1) {
  assert.ok(s.allItems[i - 1].total >= s.allItems[i].total, "sorted by total desc");
}
assert.equal(s.allItems[0].menuItemId, "m30");

const m1 = s.allItems.filter((r) => r.name === "เมนู 1");
assert.equal(m1.length, 1, "line without menuItemId merges into catalog row by name");
assert.equal(m1[0].qty, 3);
assert.equal(m1[0].total, 30);

assert.equal(s.activeMenuCount, 29);
assert.equal(s.soldMenuCount, 30);
assert.equal(s.soldMenuPct, 100, "capped at 100");
assert.notEqual(s.topCategory?.name, "อื่นๆ", "categories joined from menu");
assert.ok(!s.categories.some((c) => c.name === "อื่นๆ"));

const empty = summarizePosSalesProducts([], items, cats, 20);
assert.equal(empty.allItems.length, 0);
assert.equal(empty.topItem, null);

const noMenu = summarizePosSalesProducts(sales, [], [], 20);
assert.equal(noMenu.topCategory?.name, "อื่นๆ", "without menu everything is อื่นๆ (the old bug)");

const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
assert.match(dash, /setMenuDbMode\("owner"\)/, "dashboard reads menu from owner app");
assert.match(dash, /setMenuDbMode\("pos"\)/, "dashboard restores pos mode on unmount");
assert.match(dash, /summarizePosSalesProducts\(sales, menuItems, menuCategories, 20\)/);
assert.doesNotMatch(dash, /onOpenMenu/, "ดูเพิ่มเติม no longer navigates away");

const card = readFileSync("src/components/PosSalesDashboardProducts.tsx", "utf8");
assert.match(card, /POS_DASH_PRODUCTS_COLLAPSED = 20/);
assert.match(card, /products\.allItems/);
assert.match(card, /aria-expanded/);

// search: name or category, case-insensitive, all words must match
const rowsT = [
  { menuItemId: "a", name: "ชาเขียวนม เย็น/ปั่น", categoryId: "c1", categoryName: "Signature Drinks", qty: 3, total: 120 },
  { menuItemId: "b", name: "ชาไทย เย็น/ปั่น", categoryId: "c1", categoryName: "Signature Drinks", qty: 2, total: 80 },
  { menuItemId: "c", name: "ปังมันม่วง", categoryId: "c2", categoryName: "เบเกอรี่", qty: 1.5, total: 45.55 },
];
assert.equal(filterPosDashProducts(rowsT, "").length, 3);
assert.equal(filterPosDashProducts(rowsT, "   ").length, 3);
assert.deepEqual(filterPosDashProducts(rowsT, "ชา").map((r) => r.menuItemId), ["a", "b"]);
assert.deepEqual(filterPosDashProducts(rowsT, "signature").map((r) => r.menuItemId), ["a", "b"], "category, any case");
assert.deepEqual(filterPosDashProducts(rowsT, "ชา  เขียว").map((r) => r.menuItemId), ["a"], "all words");
assert.deepEqual(filterPosDashProducts(rowsT, "เบเกอรี่ ปัง").map((r) => r.menuItemId), ["c"], "words across name+category");
assert.equal(filterPosDashProducts(rowsT, "ไม่มี").length, 0);
assert.equal(filterPosDashProducts(rowsT, "ชา").at(0), rowsT[0], "keeps original order/objects");

// sums
const sAll = sumPosDashProducts(rowsT, 245.55);
assert.deepEqual(sAll, { count: 3, qty: 6.5, total: 245.55, pct: 100 });
const sTwo = sumPosDashProducts(rowsT.slice(0, 2), 245.55);
assert.equal(sTwo.total, 200);
assert.equal(sTwo.pct, 81.45);
assert.deepEqual(sumPosDashProducts([], 100), { count: 0, qty: 0, total: 0, pct: 0 });
assert.equal(sumPosDashProducts(rowsT, 0).pct, 0, "no div by zero");
const float = sumPosDashProducts(
  [0.1, 0.2].map((t, i) => ({ ...rowsT[0], menuItemId: String(i), total: t })),
  1,
);
assert.equal(float.total, 0.3, "money rounded");
// real summary: sum of every row equals lineTotal
assert.equal(sumPosDashProducts(s.allItems, s.lineTotal).total, s.lineTotal);
assert.equal(sumPosDashProducts(s.allItems, s.lineTotal).pct, 100);

// card wiring
assert.match(card, /type="search"/);
assert.match(card, /filterPosDashProducts\(all, query\)/);
assert.match(card, /searching \|\| expanded/, "search shows every match, not just 20");
assert.match(card, /type="checkbox"/);
assert.match(card, /เลือกทั้งหมด/);
assert.match(card, /ล้าง/);
assert.match(card, /<SumLine label="แสดง" sum=\{shownSum\} \/>/);
assert.match(card, /<SumLine label="เลือก" sum=\{pickedSum\} \/>/);
assert.match(card, /rank\.get\(row\.menuItemId\)/, "rank stays sales rank while filtered");
assert.ok(card.indexOf('className="pos-dash-prod-sum"') < card.indexOf("<ol"), "sums above the list");

console.log("test-pos-dash-products: ok");
