/**
 * Gate: BO sales report uses nPos sessions, not OT morning/evening.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 320/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 115/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+85/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.62"/);

assert.ok(existsSync(join(root, "docs/npos-session-not-ot-checklist.md")));
assert.match(read("docs/npos-session-not-ot-checklist.md"), /1\.14\.53|posSessions|ไม่ใช่กะ OT/);

const reportLib = read("src/lib/pos-sales-report.ts");
assert.match(reportLib, /shortPosSessionId/);
assert.match(reportLib, /bySession/);
assert.match(reportLib, /cashOutTotal/);
assert.match(reportLib, /sortSessionsOpenFirst|where\("date"/);
assert.doesNotMatch(reportLib, /orderBy\("shift"/);
assert.doesNotMatch(reportLib, /from "\.\/ot"|OT_SHIFTS/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /shortPosSessionId/);
assert.match(slim, /รอบการขาย nPos|ระหว่างกะ/);
assert.doesNotMatch(slim, /labelOtShift|OtShiftId|shortShift/);
assert.doesNotMatch(slim, /setShiftId|shiftOptions|morning.*evening.*late/);

const page = read("src/components/PosSalesReport.tsx");
assert.match(page, /shortPosSessionId|bySession/);
assert.match(page, /แยกตามรอบ nPos/);
assert.doesNotMatch(page, /labelOtShift|แยกตามกะ/);

const devices = read("src/components/NposDevicesPanel.tsx");
assert.match(devices, /shortPosSessionId/);
assert.doesNotMatch(devices, /labelOtShift/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /cashOutTotal/);
assert.match(cf, /cashInTotal/);
assert.match(cf, /cashDropCount/);

console.log("ok: npos-session-not-ot gate");
