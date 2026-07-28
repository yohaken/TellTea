/**
 * Gate: BO super-slim session rows + heartbeat chips in table.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 308/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 103/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+73/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.50"/);

assert.ok(existsSync(join(root, "docs/npos-bo-slim-sessions-checklist.md")));
const doc = read("docs/npos-bo-slim-sessions-checklist.md");
assert.match(doc, /1\.14\.50/);
assert.match(doc, /Super Slim|ชีพจร|เช็คเซิร์ฟเวอร์/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /PosSessionsSlimTable/);
assert.match(slim, /PulseChips|HEARTBEAT_INTERVAL_PRESETS/);
assert.match(slim, /npos-slim-row/);
assert.match(slim, /setHeartbeatIntervalSec/);
assert.match(slim, /subscribePosDevicesAdmin/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /PosSessionsSlimTable/);
assert.match(report, /npos-bo-page-head|npos-slim-text-btn/);
assert.doesNotMatch(report, /SessionShiftCard/);

const css = read("src/app/globals.css");
assert.match(css, /\.npos-slim-sessions/);
assert.match(css, /\.npos-slim-row/);
assert.match(css, /\.npos-slim-text-btn/);
assert.match(css, /\.npos-slim-pulse/);
assert.match(css, /pos-sales-bill-chips--text/);

console.log("ok: npos-bo-slim-sessions gate");
