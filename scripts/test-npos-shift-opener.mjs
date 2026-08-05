/**
 * Gate: O1 shift opener — pick employee name at clock-in (not OT-linked).
 * After close: clear last opener so next open requires an explicit name pick.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const gradle = read("npos-telltea/app/build.gradle");
const code = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const name = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
assert.ok(code >= 136, `versionCode expected ≥136, got ${code}`);
assert.ok(name, "versionName missing");

const pin = read("src/lib/npos-apk-release.ts");
assert.match(
  pin,
  new RegExp(`NPOS_SYSTEM_VERSION_NAME = "${name.replace(/\./g, "\\.")}"`),
);
assert.match(pin, new RegExp(`NPOS_SYSTEM_VERSION_CODE = ${code};`));

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 718);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 181);

assert.ok(existsSync(join(root, "docs/npos-shift-opener-checklist.md")));
const doc = read("docs/npos-shift-opener-checklist.md");
assert.match(doc, /openedByName|OpenShiftFlow/);
assert.match(doc, /ไม่ผูก|ไม่.*OT|นอกสcope/);
assert.match(doc, /หลังปิด|ไม่จำ|เลือกชื่อ|เริ่มรอบ/);
assert.match(doc, /รายชื่อ|roster|ไม่.*พิมพ์|ระบบเท่านั้น/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /open_shift_who_title">ใครเริ่มรอบนี้</);
assert.match(strings, /open_shift_who_hint">แตะชื่อจากรายชื่อพนักงานในระบบเท่านั้น</);
assert.match(strings, /open_shift_who_confirm">เริ่มรอบ</);
assert.match(strings, /open_shift_who_required/);
assert.match(strings, /open_shift_who_empty_roster/);

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
// Fresh pick: no lastOpenedBy preselect; roster-only (no free type)
assert.doesNotMatch(openFlow, /lastOpenedByEmployeeId|lastOpenedByName/);
assert.doesNotMatch(openFlow, /EditText|typedName|open_shift_who_or_type|open_shift_who_type_hint/);
assert.match(openFlow, /open_shift_who_empty_roster/);
assert.match(openFlow, /onRoster/);
assert.match(openFlow, /final String\[] pickId = \{""\}/);
assert.match(openFlow, /final String\[] pickName = \{""\}/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java",
);
assert.match(prefs, /openedByEmployeeId|openedByName/);
assert.match(prefs, /lastOpenedByEmployeeId|lastOpenedByName/);
assert.match(prefs, /setOpenedBy/);
assert.match(prefs, /public static void close\([\s\S]*KEY_LAST_OPENED_BY_ID/);
assert.match(prefs, /public static void close\([\s\S]*KEY_OPENED_BY_NAME/);

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

assert.match(read("scripts/check-npos-shop.mjs"), /shift-opener/);

console.log(`OK test-npos-shift-opener ${name} (${code})`);
