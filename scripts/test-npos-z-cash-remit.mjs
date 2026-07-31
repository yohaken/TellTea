/**
 * Gate: Z slip cash block = daily cash-remit evidence (FoodStory-shaped + correct math).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 532/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 148/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+117/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.94"/);

assert.ok(existsSync(join(root, "docs/npos-z-cash-remit-checklist.md")));
const doc = read("docs/npos-z-cash-remit-checklist.md");
assert.match(doc, /1\.14\.94/);
assert.match(doc, /ยอดเงินสดที่ต้องนำส่ง|นับจริง [-−] ทอนรอบถัดไป/);
assert.match(doc, /เงินเข้า [-−] เงินออก|cashIn.*cashOut|inAmt - outAmt/);

const builder = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(builder, /cashOutTotal/);
assert.match(builder, /cashInTotal/);
assert.match(builder, /netInOut = inAmt - outAmt/);
assert.match(builder, /ยอดเงินสดที่ต้องนำส่ง/);
assert.match(builder, /\*นับจริง - ทอนรอบถัดไป/);
assert.match(builder, /ตรวจก่อนเซ็น \/ ส่งเงิน/);
assert.match(builder, /นับรวมเงินทอนเริ่มต้นแล้ว/);
assert.match(builder, /ยอดที่ต้องนำส่งตรงกับเงินในมือ/);
assert.match(builder, /ลงชื่อผู้ส่งเงิน/);
assert.match(builder, /ลงชื่อผู้รับเงิน/);
assert.match(builder, /สรุปส่งเงินสด/);
assert.match(builder, /remit = Math\.max\(0, counted - Math\.max\(0, leaveFloat\)\)/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /cashOutTotal/);
assert.match(sync, /cashInTotal/);
assert.match(sync, /ShiftReportFormBuilder\.build/);

const web = read("src/lib/pos-printer/shift-snapshot-template.ts");
assert.match(web, /cashOutTotal/);
assert.match(web, /cashInTotal/);
assert.match(web, /netInOut/);
assert.match(web, /ยอดเงินสดที่ต้องนำส่ง/);
assert.match(web, /นับจริง [-−] ทอนรอบถัดไป/);
assert.match(web, /ตรวจก่อนเซ็น \/ ส่งเงิน/);
assert.match(web, /ลงชื่อผู้ส่งเงิน/);
assert.match(web, /ลงชื่อผู้รับเงิน/);
assert.match(web, /สรุปส่งเงินสด/);
// must not hardcode cash in/out to zero forever
assert.doesNotMatch(web, /เงินเข้า\/เงินออก<\/span><span>\$\{money\(0\)\}/);

const payload = read("src/lib/pos-shift-report.ts");
assert.match(payload, /cashOutTotal/);
assert.match(payload, /cashInTotal/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-z-cash-remit-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /z-cash-remit/);

console.log("OK test-npos-z-cash-remit");
