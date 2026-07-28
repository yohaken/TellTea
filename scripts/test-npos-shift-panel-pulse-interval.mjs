/**
 * Gate: mid-shift panel + BO-configurable tablet heartbeat interval.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 325/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 119/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+89/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.66"/);

assert.ok(existsSync(join(root, "docs/npos-shift-panel-pulse-interval-checklist.md")));
const doc = read("docs/npos-shift-panel-pulse-interval-checklist.md");
assert.match(doc, /1\.14\.48/);
assert.match(doc, /heartbeatIntervalSec|5–600|cash drop|ถอน/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/OpsPulsePrefs.java",
);
assert.match(prefs, /DEFAULT_SEC\s*=\s*5/);
assert.match(prefs, /MIN_SEC\s*=\s*5/);
assert.match(prefs, /MAX_SEC\s*=\s*600/);
assert.match(prefs, /applyFromServer/);

const hb = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ForegroundHeartbeat.java",
);
assert.match(hb, /OpsPulsePrefs\.heartbeatIntervalMs|currentIntervalMs/);
assert.match(hb, /scheduleNext/);

const device = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/DeviceHeartbeat.java",
);
assert.match(device, /heartbeatIntervalSec/);
assert.match(device, /OpsPulsePrefs\.applyFromServer/);

const coord = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/update/UpdateCheckCoordinator.java",
);
assert.match(coord, /throttleMs|OpsPulsePrefs/);
assert.match(coord, /onServerSyncPulse/);

const cf = read("functions/npos-heartbeat.js");
assert.match(cf, /heartbeatIntervalSec/);
assert.match(cf, /Math\.max\(5,\s*Math\.min\(600/);

const syncLib = read("src/lib/pos-tablet-sync.ts");
assert.match(syncLib, /heartbeatIntervalSec/);
assert.match(syncLib, /HEARTBEAT_INTERVAL_PRESETS/);
assert.match(syncLib, /clampHeartbeatIntervalSec/);

const panel = read("src/components/PosTabletSyncPanel.tsx");
assert.match(panel, /PosTabletSyncPanel/);
assert.match(panel, /setHeartbeatIntervalSec/);

assert.match(read("src/components/PosManagePanel.tsx"), /PosTabletSyncPanel/);

const shiftPrefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(shiftPrefs, /recordCashDrop|KEY_CASH_OUT|expectedCash/);

const shiftAct = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java",
);
assert.match(shiftAct, /askCashDrop|voidSessionStats|shift_panel_/);
assert.match(shiftAct, /dutyTick|refreshDashboard|refreshOverview/);

const report = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseReport.java",
);
assert.match(report, /cashOutTotal|cashDropCount/);
assert.match(report, /openingCash \+ cashSales - this\.cashOutTotal/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /VoidSessionStats|voidStatsForSession/);
assert.match(saleSync, /ShiftPrefs\.expectedCash/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-shift-panel-pulse-interval-checklist/);

console.log("OK test-npos-shift-panel-pulse-interval");
