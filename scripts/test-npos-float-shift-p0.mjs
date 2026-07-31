/**
 * Gate: open-shift crash fix + leave-float P0.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 528/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 146/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+115/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.92"/);

assert.ok(existsSync(join(root, "docs/npos-float-shift-p0-checklist.md")));
assert.match(read("docs/npos-float-shift-p0-checklist.md"), /1.14.42/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /shift_summary_fmt.*%2\$s.*%3\$s/);
assert.doesNotMatch(strings, /shift_summary_fmt.*%2\$\.0f/);
assert.match(strings, /blind_close_leave_too_high/);

const prefs = read("npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java");
assert.match(prefs, /summaryLine/);
assert.match(prefs, /open\([\s\S]*double openingCash/);
assert.match(prefs, /\.commit\(\)/);

const openFlow = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java",
);
assert.match(
  openFlow,
  /openSession\(\s*activity\s*,\s*openingCash\s*,\s*openerId\s*,\s*openerName/,
);
assert.doesNotMatch(openFlow, /setNextOpeningCash/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /openSession\(Context context, double openingCash/);
assert.match(saleSync, /openedByEmployeeId|openedByName/);

const blind = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseFlow.java",
);
assert.match(blind, /leaveSeed|Math\.min\(opening/);
assert.match(blind, /blind_close_leave_too_high/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /leaveFloat|ทอนค้าง/);
assert.match(read("src/lib/types.ts"), /leaveFloat/);
assert.match(read("src/lib/pos-sales-report.ts"), /leaveFloat/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-float-shift-p0-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /float-shift-p0/);

console.log("OK test-npos-float-shift-p0");
