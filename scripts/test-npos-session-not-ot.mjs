/**
 * Gate: BO sales report uses nPos sessions, not OT morning/evening.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 530/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 147/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+116/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.93"/);

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
assert.match(slim, /posSessionCode/);
assert.match(slim, /รอบการขาย nPos|ระหว่างกะ/);
assert.doesNotMatch(slim, /labelOtShift|OtShiftId|shortShift/);
assert.doesNotMatch(slim, /setShiftId|shiftOptions|morning.*evening.*late/);

const page = read("src/components/PosSalesReport.tsx");
assert.match(page, /shortPosSessionId|bySession|ช่องทาง · เมนูขายดี/);
assert.match(page, /แยกตามรอบ nPos|รอบการขาย nPos|PosSessionsSlimTable/);
assert.doesNotMatch(page, /labelOtShift|แยกตามกะ/);

const devices = read("src/components/NposDevicesPanel.tsx");
assert.doesNotMatch(devices, /shortPosSessionId|openRoundBar|subscribePosSessionsForDate/);
assert.doesNotMatch(devices, /labelOtShift/);
assert.match(devices, /เวอร์ชันระบบ|เวอร์ชัน nPos/);

const cf = read("functions/npos-sell.js");
assert.match(cf, /cashOutTotal/);
assert.match(cf, /cashInTotal/);
assert.match(cf, /cashDropCount/);

console.log("ok: npos-session-not-ot gate");
