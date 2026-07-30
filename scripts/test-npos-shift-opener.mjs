/**
 * Gate: O1 shift opener — pick employee name at clock-in (not OT-linked).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 511/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 143/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+112/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.89"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_NAME = "1.14.89"/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 112/);

assert.ok(existsSync(join(root, "docs/npos-shift-opener-checklist.md")));
const doc = read("docs/npos-shift-opener-checklist.md");
assert.match(doc, /1\.14\.89|openedByName|OpenShiftFlow/);
assert.match(doc, /ไม่ผูก|ไม่.*OT|นอกสcope/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /open_shift_who_title/);
assert.match(strings, /open_shift_who_hint/);
assert.match(strings, /open_shift_who_confirm/);
assert.match(strings, /open_shift_who_required/);

const roster = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/EmployeeRoster.java",
);
assert.match(roster, /employees/);
assert.match(roster, /shopJson/);
assert.doesNotMatch(roster, /otSessions|workerIds|OtShift/);

const openFlow = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java",
);
assert.match(openFlow, /askWhoOpened|EmployeeRoster/);
assert.match(openFlow, /openSession\(\s*activity\s*,\s*openingCash\s*,\s*openerId\s*,\s*openerName/);
assert.doesNotMatch(openFlow, /otSessions|workerIds|ตารางกะ|OtShift/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(prefs, /openedByEmployeeId|openedByName/);
assert.match(prefs, /lastOpenedByEmployeeId|lastOpenedByName/);
assert.match(prefs, /setOpenedBy/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(
  saleSync,
  /openSession\(\s*Context context,\s*double openingCash,\s*String openedByEmployeeId,\s*String openedByName/,
);
assert.match(saleSync, /putOpenedBy|applyOpenedByFromServer/);
assert.match(saleSync, /openedByName/);

const z = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(z, /openedByName/);
assert.match(z, /receiptStaffName/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /employees/);
assert.match(cf, /openedByEmployeeId/);
assert.match(cf, /openedByName/);
assert.match(cf, /nposShopSettings/);
assert.match(cf, /nposSessionOpen/);

const types = read("src/lib/types.ts");
assert.match(types, /openedByName\??:/);
assert.match(types, /openedByEmployeeId\??:/);

const map = read("src/lib/pos-sales-report.ts");
assert.match(map, /openedByName/);
assert.match(map, /openedByEmployeeId/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /openedBy|ผู้เปิดกะ/);
assert.match(slim, /searchBlob/);

const phases = read("docs/npos-counter-ops-phases.md");
assert.match(phases, /O1/);
assert.match(phases, /1\.14\.89/);

assert.match(read("scripts/check-npos-shop.mjs"), /shift-opener/);

console.log("OK test-npos-shift-opener");
