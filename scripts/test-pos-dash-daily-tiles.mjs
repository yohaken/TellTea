/**
 * POS dashboard: daily sales box — today on top, 2–3 column tiles, no inner scroll.
 * Run: node scripts/test-pos-dash-daily-tiles.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const charts = readFileSync("src/components/PosSalesDashboardCharts.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

const start = charts.indexOf("export function PosDashDailyTotalsTable");
const end = charts.indexOf("export function PosDashDailyAreaChart");
assert.ok(start > 0 && end > start);
const box = charts.slice(start, end);

// Today pulled out of the tiles and shown first.
assert.match(box, /const today = points\.find\(\(p\) => p\.dateKey === todayKey\)/);
assert.match(box, /filter\(\(p\) => p\.dateKey !== todayKey\)/);
assert.ok(box.indexOf("pos-dash-dt-today") < box.indexOf("pos-dash-dt-grid"), "today above tiles");
assert.match(box, /ยังไม่จบวัน/);
assert.match(box, /\[\.\.\.points\]\.reverse\(\)/, "newest first");

// Long ranges collapse; tiles show weekday + bills.
assert.match(charts, /POS_DASH_DAY_TILES_COLLAPSED = 31/);
assert.match(box, /aria-expanded=\{expanded\}/);
assert.match(box, /POS_DASH_WEEKDAY_TH_SHORT\[bangkokWeekday\(p\.dateMs\)\]/);
assert.match(box, /is-best|is-worst/);

// Layout: 2 columns, 3 when the card is wide; no fixed-height scroll box.
assert.match(css, /\.pos-dash-dt-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /@container \(min-width: 480px\) \{\s*\.pos-dash-dt-grid \{\s*grid-template-columns: repeat\(3/);
// Column-major: newest runs down column 1, then continues at the top of column 2.
assert.match(css, /\.pos-dash-dt-grid \{[^}]*grid-auto-flow: column;[^}]*grid-template-rows: repeat\(var\(--dt-rows-2, 1\), auto\)/);
assert.match(css, /@container \(min-width: 480px\) \{\s*\.pos-dash-dt-grid \{[^}]*grid-template-rows: repeat\(var\(--dt-rows-3, 1\), auto\)/);
assert.match(box, /"--dt-rows-2": Math\.ceil\(shown\.length \/ 2\)/);
assert.match(box, /"--dt-rows-3": Math\.ceil\(shown\.length \/ 3\)/);
assert.doesNotMatch(css, /\.pos-dash-day-table-scroll/);
assert.match(css, /\.pos-dash-dt-today-amt \{[^}]*font-size: 1\.65rem[^}]*color: #2f7d4a/);

console.log("test-pos-dash-daily-tiles: ok");
