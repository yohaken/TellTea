/**
 * Gate: POS sales dashboard phase 0–1 — tabs, date range, summary cards.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 624/);

assert.ok(existsSync(join(root, "docs/pos-sales-dashboard-phases.md")));
const doc = read("docs/pos-sales-dashboard-phases.md");
assert.match(doc, /เฟส 0/);
assert.match(doc, /เฟส 1/);
assert.match(doc, /subscribePosSalesForDateRange|ช่วงวันที่/);

const lib = read("src/lib/pos-sales-report.ts");
assert.match(lib, /subscribePosSalesForDateRange/);
assert.match(lib, /defaultPosDashboardRange/);
assert.match(lib, /clampPosDateRange/);
assert.match(lib, /normalizePosDateRange/);
assert.match(lib, /posDateRangeDayCountRaw/);
assert.match(lib, /POS_DASHBOARD_MAX_RANGE_DAYS/);
assert.match(lib, /formatPosDateRangeLabel/);
assert.match(lib, /primaryReady|legacyReady/);
assert.match(lib, /where\("date", ">="/);
assert.match(lib, /where\("date", "<="/);

const dash = read("src/components/PosSalesDashboard.tsx");
assert.match(dash, /ยอดขายสุทธิ/);
assert.match(dash, /บิลที่ปิดไปแล้ว/);
assert.match(dash, /บิลที่ยกเลิก/);
assert.match(dash, /ทำลาย/);
assert.match(dash, /ยังไม่มีในระบบ/);
assert.match(dash, /เงินสด|PromptPay|โอน/);
assert.doesNotMatch(dash, /ทานที่ร้าน|ซื้อกลับบ้าน/);
assert.doesNotMatch(dash, /ค่าบริการ|ภาษี 7%|ยอดปัดเศษ/);

const page = read("src/components/PosSalesReport.tsx");
assert.match(page, /PosSalesDashboard/);
assert.match(page, /dashboard|sessions|manage/);
assert.match(page, /resolvePosSalesTab|tab === "dashboard"/);
assert.match(page, /แดชบอร์ด/);
assert.match(page, /รอบขาย/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-dash-top-grid/);
assert.match(css, /\.pos-dash-card--net/);
assert.match(css, /\.pos-dash-donut/);

console.log("OK test-pos-sales-dashboard-p0-p1");
