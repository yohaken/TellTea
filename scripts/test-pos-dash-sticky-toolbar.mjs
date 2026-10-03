/**
 * POS dashboard: date toolbar sticks under the topbar; changing range keeps the view in place.
 * Run: node scripts/test-pos-dash-sticky-toolbar.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

// Toolbar + custom-range panel live in one sticky wrapper; layout settings stay in the flow.
const stickyAt = dash.indexOf('className={`pos-dash-sticky');
const toolbarAt = dash.indexOf('className="pos-dash-toolbar"');
const pickerAt = dash.indexOf('className="pos-dash-range-panel"');
const layoutAt = dash.indexOf("<PosSalesDashboardLayoutSettings");
assert.ok(stickyAt > 0 && stickyAt < toolbarAt && toolbarAt < pickerAt && pickerAt < layoutAt);
assert.match(dash, /ref=\{toolbarRef\}/);
assert.match(dash, /"--pos-dash-sticky-top": `\$\{stickyTop\}px`/);
assert.match(dash, /querySelector<HTMLElement>\("\.topbar"\)/);
assert.match(dash, /new ResizeObserver\(measure\)/);

assert.match(css, /\.pos-dash-sticky \{[^}]*position: sticky;[^}]*top: var\(--pos-dash-sticky-top, 0px\)/);
// main-panel is overflow:auto (never scrolls) — sticky only works once it is visible.
assert.match(css, /\.main-panel:has\(\.pos-dash-sticky\) \{\s*overflow: visible;/);

// Every range change goes through the anchoring setter (no direct state writes).
assert.match(dash, /const \[range, setRangeState\] = useState/);
assert.equal((dash.match(/setRangeState\(/g) || []).length, 1, "only setRange writes range");
assert.match(dash, /if \(next\.startMs === range\.startMs && next\.endMs === range\.endMs\) return;/);
assert.match(dash, /scrollAnchor\.current = slot\?\.dataset\.card/);

// Restore after sales load, keep correcting while late data resizes cards, release on user input.
assert.match(dash, /useLayoutEffect\(\(\) => \{\s*const anchor = scrollAnchor\.current;\s*if \(!anchor \|\| loading\) return;/);
assert.match(dash, /window\.scrollBy\(0, delta\)/);
assert.match(dash, /const ro = new ResizeObserver\(correct\)/);
assert.match(dash, /ANCHOR_RELEASE_EVENTS = \["wheel", "touchstart", "pointerdown", "keydown"\]/);
assert.match(dash, /setTimeout\(release, 2500\)/);
// Scrolling while the new range still loads drops the anchor (no snap back).
assert.match(dash, /const drop = \(\) => \{\s*scrollAnchor\.current = null;/);

// Dimmed stale cards compute against the range their sales belong to, not the new range.
assert.match(dash, /setSales\(list\);\s*setSalesRange\(clamped\);/);
assert.match(dash, /summarizePosSalesByDay\(sales, salesRange\)/);
assert.match(dash, /averagePerDay\(summary\.total, salesRange\)/);
assert.match(dash, /summarizePosSalesByTimeBand\(sales, salesDayCount\)/);
assert.match(dash, /<PosSalesDashboardWeekdays sales=\{sales\} range=\{salesRange\} \/>/);

// Desktop frame: overflow clip (not hidden) so sticky follows the window.
assert.match(css, /@media \(min-width: 900px\) \{\s*\.phone-frame:has\(\.pos-dash-sticky\) \{\s*overflow: clip;/);

// Old cards stay mounted (dimmed) while a new range loads — no collapse back to the top.
assert.match(dash, /loading && !hasShownCards\.current \? <p className="empty">/);
assert.match(dash, /\(!loading \|\| hasShownCards\.current\) && !rangeTooLong/);
assert.match(dash, /pos-dash-flow\$\{loading \? " is-loading" : ""\}/);
assert.match(css, /\.pos-dash-flow\.is-loading \{[^}]*opacity: 0\.55/);

console.log("test-pos-dash-sticky-toolbar: ok");
