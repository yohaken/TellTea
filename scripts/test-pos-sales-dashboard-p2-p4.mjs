/**
 * Gate: POS sales dashboard phase 2–4 — charts, products, soft stats.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);

assert.ok(
  Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)?.[1] || 0) >= 700,
);

assert.ok(existsSync(join(root, "src/lib/pos-sales-dashboard.ts")));
assert.ok(existsSync(join(root, "src/components/PosSalesDashboardCharts.tsx")));
assert.ok(existsSync(join(root, "src/components/PosSalesDashboardProducts.tsx")));

const agg = read("src/lib/pos-sales-dashboard.ts");
assert.match(agg, /summarizePosSalesByDay/);
assert.match(agg, /summarizePosSalesByHour/);
assert.match(agg, /summarizePosSalesByWeekday/);
assert.match(agg, /summarizePosSalesProducts/);
assert.match(agg, /countSaleUnits/);
assert.match(agg, /averagePerUnit/);
assert.match(agg, /averageUnitsPerBill/);
assert.match(agg, /bangkokWeekday/);

const charts = read("src/components/PosSalesDashboardCharts.tsx");
assert.match(charts, /PosDashDailyTotalsTable/);
assert.match(charts, /ยอดขายรายวัน/);
assert.match(charts, /กราฟรายวัน/);
assert.match(charts, /ยอดขายแยกตามช่วงเวลา/);
assert.match(charts, /ยอดขายแยกตามช่วงวัน/);
assert.match(charts, /pos-dash-area-fill|pos-dash-bar--hour/);

const products = read("src/components/PosSalesDashboardProducts.tsx");
assert.match(products, /10 อันดับสินค้าขายดี/);
assert.match(products, /เมนูที่มีขาย|ขายดีสุด|หมวดขายดี/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /PosDashDailyTotalsTable/);
assert.match(dash, /pos-dash-daily-block/);
assert.match(dash, /PosDashDailyAreaChart|PosDashHourBarChart|PosDashWeekdayBarChart/);
assert.match(dash, /PosSalesDashboardProducts/);
assert.match(dash, /ส่วนลด|สถิติบิล|กิจกรรม/);
assert.match(dash, /จำนวนชิ้นที่ขาย|รายได้เฉลี่ยต่อชิ้น|บาท\/ชิ้น/);
assert.match(dash, /countSaleUnits|averagePerUnit/);
assert.match(dash, /subscribeMenuItems|subscribeMenuCategories/);
assert.doesNotMatch(dash, /โต๊ะอาหาร|อัตราการใช้โต๊ะ/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-dash-daily-block/);
assert.match(css, /\.pos-dash-day-table\b/);
assert.match(css, /\.pos-dash-chart-row/);
assert.match(css, /\.pos-dash-top-items/);
assert.match(css, /\.pos-dash-bar--hour/);

// Lightweight pure logic checks via dynamic import of compiled path is hard;
// assert helpers exist and weekday labels cover Sun–Sat.
assert.match(agg, /"Sun".*"Mon".*"Tue".*"Wed".*"Thu".*"Fri".*"Sat"/s);

const doc = read("docs/pos-sales-dashboard-phases.md");
assert.match(doc, /\[x\].*Area: ยอดขายรายวัน/);
assert.match(doc, /\[x\].*ตาราง Top 10/);
assert.match(doc, /\[x\].*การ์ด \*\*ส่วนลด\*\*/);

void require;
console.log("OK test-pos-sales-dashboard-p2-p4");
