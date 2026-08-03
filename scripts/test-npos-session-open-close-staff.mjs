/**
 * Gate: session opener/closer columns + persist closer on tablet/BO close.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 675);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 178);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+134/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.111"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1\.14\.111"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 134/);

const types = read("src/lib/types.ts");
assert.match(types, /closedByName\?:/);
assert.match(types, /closedByEmployeeId\?:/);
assert.match(types, /closeSource\?:/);

const report = read("src/lib/pos-sales-report.ts");
assert.match(report, /closedByName: str\("closedByName"\)/);
assert.match(report, /export function posSessionCloserLabel/);

const admin = read("src/lib/pos-sales-admin.ts");
assert.match(admin, /closedByName/);
assert.match(admin, /closeSource:\s*"bo-force"/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /closedByName/);
assert.match(cf, /closeSource = "tablet"/);
assert.match(cf, /Keep BO force-close actor/);
assert.match(cf, /backfill when the open round still has no opener/);
assert.match(cf, /bodyOpenerName && !existingOpenerName/);

const sync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(sync, /putClosedBy/);
assert.match(sync, /closedByName/);
assert.match(sync, /needsOpenerServerSync/);
assert.match(sync, /noteOpenerSyncResult/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(prefs, /KEY_OPENER_SERVER_OK/);
assert.match(prefs, /needsOpenerServerSync/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /พนักงานเปิดรอบ/);
assert.match(slim, /พนักงานปิดรอบ/);
assert.match(slim, /npos-slim-staff/);
assert.match(slim, /posSessionCloserLabel/);
assert.match(slim, />\s*เข้า\s*</);
assert.match(slim, />\s*ปิดโดย\s*</);

const ui = read("src/components/PosSalesReport.tsx");
assert.match(ui, /closedByName/);
assert.match(ui, /closePosSessionAdmin\([\s\S]*closedByName/);

const css = read("src/app/globals.css");
assert.match(css, /npos-slim-staff/);
assert.match(css, /opener\/closer/);

const manual = read("src/lib/pos-session-remit.ts");
assert.match(manual, /closedByName = openedByName/);

console.log("OK test-npos-session-open-close-staff");
