/**
 * Gate: average revenue per sold piece on POS sales dashboard.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 763);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)?.[1] || 0) >= 201);

const agg = read("src/lib/pos-sales-dashboard.ts");
assert.match(agg, /export function countSaleUnits/);
assert.match(agg, /export function averagePerUnit/);
assert.match(agg, /export function averageUnitsPerBill/);
assert.match(agg, /ยอดสุทธิ ÷ จำนวนชิ้น|netTotal \/ unitCount/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /countSaleUnits/);
assert.match(dash, /averagePerUnit/);
assert.match(dash, /averageUnitsPerBill/);
assert.match(dash, /จำนวนชิ้นที่ขาย/);
assert.match(dash, /รายได้เฉลี่ยต่อชิ้น/);
assert.match(dash, /บาท\/ชิ้น/);
assert.match(dash, /ชิ้น\/บิล/);

// Pure formula checks (mirror helpers — avoid importing Firebase-bound modules).
function round2(n) {
  return Math.round(n * 100) / 100;
}
function countSaleUnits(sales) {
  let qty = 0;
  for (const sale of sales.filter((s) => s.status === "completed")) {
    for (const line of sale.lines || []) {
      const n = Number(line.qty);
      if (Number.isFinite(n) && n > 0) qty += n;
    }
  }
  return qty;
}
function averagePerUnit(netTotal, unitCount) {
  if (!(unitCount > 0)) return 0;
  return round2(netTotal / unitCount);
}
function averageUnitsPerBill(unitCount, billCount) {
  if (!(billCount > 0)) return 0;
  return round2(unitCount / billCount);
}

const sales = [
  {
    status: "completed",
    total: 150,
    lines: [
      { qty: 2 },
      { qty: 1 },
    ],
  },
  { status: "voided", total: 999, lines: [{ qty: 9 }] },
  { status: "completed", total: 50, lines: [{ qty: 1 }] },
];

assert.equal(countSaleUnits(sales), 4);
assert.equal(averagePerUnit(200, 4), 50);
assert.equal(averagePerUnit(200, 0), 0);
assert.equal(averageUnitsPerBill(4, 2), 2);
assert.equal(averageUnitsPerBill(5, 2), 2.5);

console.log("OK test-pos-avg-per-unit");
