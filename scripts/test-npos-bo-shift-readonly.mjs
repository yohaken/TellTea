/**
 * Gate: BO shift view-only + session cards + native open float.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 527/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 146/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+115/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.92"/);

assert.ok(existsSync(join(root, "docs/npos-bo-shift-readonly-checklist.md")));
const doc = read("docs/npos-bo-shift-readonly-checklist.md");
assert.match(doc, /1.14.42/);
assert.match(doc, /ดูอย่างเดียว|view-only|ไม่มีปุ่ม/);

const shift = read("src/components/PosShiftView.tsx");
assert.doesNotMatch(shift, /ออกงาน \(ปิดรอบ\)|requestCloseShift|handleCloseShift/);
assert.match(shift, /ปิดกะทำบนแอป nPos|pos-shift-bo-note/);

const report = read("src/components/PosSalesReport.tsx");
assert.match(report, /PosSessionsSlimTable/);
assert.match(report, /selectedSessionId/);

const slim = read("src/components/PosSessionsSlimTable.tsx");
assert.match(slim, /openingCash|ทอนเริ่ม/);
assert.match(slim, /closingCashCounted|นับ /);
assert.match(slim, /เงินสดที่นับในลิ้นชัก|ยอดนำส่ง = นับ/);
assert.match(slim, /leaveFloat|ทอนค้าง/);

const types = read("src/lib/types.ts");
assert.match(types, /closingCashCounted/);
assert.match(types, /leaveFloat/);
assert.match(types, /openedByName/);

const salesReport = read("src/lib/pos-sales-report.ts");
assert.match(salesReport, /salesForSession/);
assert.match(salesReport, /closingCashCounted/);
assert.match(salesReport, /openedByName/);

const openFn = read("functions/npos-sell.js");
assert.match(openFn, /openingCash/);
assert.match(openFn, /openedByName/);

assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java"),
  ),
);
const openFlow = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/OpenShiftFlow.java",
);
assert.match(openFlow, /askOpeningFloat|open_shift_float/);
assert.match(
  openFlow,
  /openSession\(\s*activity\s*,\s*openingCash\s*,\s*openerId\s*,\s*openerName/,
);
assert.doesNotMatch(openFlow, /setNextOpeningCash/);
assert.doesNotMatch(openFlow, /OtShift|workerIds|ตารางกะ/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /OpenShiftFlow/);

const z = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(z, /ลงชื่อผู้ส่งเงิน|ลงชื่อผู้ส่งกะ/);
assert.match(z, /ลงชื่อผู้รับเงิน|ลงชื่อผู้รับกะ/);
assert.doesNotMatch(z, /ลงชื่อผู้จัดการ\/เจ้าของ/);
assert.match(z, /openedByName/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-bo-shift-readonly-checklist/);

console.log("OK test-npos-bo-shift-readonly");
