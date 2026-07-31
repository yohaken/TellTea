/**
 * Gate: BO super-slim session rows + filters + day summary + compact fold.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 549/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 160/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+127/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.104"/);

assert.ok(existsSync(join(root, "docs/npos-bo-slim-sessions-checklist.md")));
const doc = read("docs/npos-bo-slim-sessions-checklist.md");
assert.match(doc, /slim|สรุป|ปิดกะ/i);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /PosSessionsSlimTable/);
assert.match(slim, /PulseChips|HEARTBEAT_INTERVAL_PRESETS/);
assert.match(slim, /npos-slim-row/);
assert.match(slim, /npos-slim-summary/);
assert.match(slim, /npos-slim-filters/);
assert.match(slim, /openOnly|setOpenOnly/);
assert.match(slim, /closedAt/);
assert.match(slim, /setHeartbeatIntervalSec/);
assert.match(slim, /ปิดกะที่แท็บเล็ตเท่านั้น/);
assert.match(slim, /selectedIds|ลบที่เลือก|npos-slim-check-col/);
assert.doesNotMatch(slim, /onClick=\{[^}]*close|ปิดรอบการขาย/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /PosSessionsSlimTable/);
assert.match(report, /npos-bo-page-head|npos-slim-text-btn/);
assert.match(report, /pos-sales-fold--slim/);
assert.match(report, /npos-slim-row--compact/);
assert.match(report, /pos-sales-bills/);
assert.doesNotMatch(report, /SessionShiftCard/);
assert.doesNotMatch(report, /pos-sales-summary-card/);
assert.doesNotMatch(report, /npos-slim-date-nav/);

const css = read("src/app/globals.css");
assert.match(css, /\.npos-slim-sessions/);
assert.match(css, /\.npos-slim-row/);
assert.match(css, /\.npos-slim-text-btn/);
assert.match(css, /\.npos-slim-pulse/);
assert.match(css, /\.npos-slim-summary/);
assert.match(css, /\.npos-slim-filters/);
assert.match(css, /pos-sales-bill-chips--text/);

console.log("ok: npos-bo-slim-sessions gate");
