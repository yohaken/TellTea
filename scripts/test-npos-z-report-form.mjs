/**
 * Gate: native Z/X shift report form (shop header, times, signature lines).
 * Extended for web-parity labels (1.14.107+).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 581);
assert.ok(Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]) >= 166);
assert.ok(Number((read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/) || [])[1]) >= 130);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);

assert.ok(existsSync(join(root, "docs/npos-z-report-form-checklist.md")));
const doc = read("docs/npos-z-report-form-checklist.md");
assert.match(doc, /1\.14\.\d+|ShiftReportFormBuilder/);
assert.match(doc, /ลงชื่อ|เซ็น/);
assert.match(doc, /ไม่.*Delivery|ไม่มี.*Delivery/);

const builder = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
for (const token of [
  "รายงานยอดการขาย",
  "Snapshot ระหว่างรอบการขาย",
  "เปิดรอบ",
  "ปิดรอบ",
  "เงินสดเริ่มต้น",
  "นับจริงในลิ้นชัก",
  "ส่วนต่าง",
  "ตรวจก่อนเซ็น / ส่งเงิน",
  "ลงชื่อผู้ส่งเงิน",
  "ลงชื่อผู้รับเงิน",
  "ยอดเงินสดที่ต้องนำส่ง",
  "PromptPay",
  "ไม่ใช่การปิดรอบ",
  "receiptStaffName",
  "padLeft",
]) {
  assert.match(builder, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(builder, /"ทานที่ร้าน"|"Lineman"|"Grab"|"ShopeeFood"|Delivery/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /ShiftReportFormBuilder/);
assert.match(sync, /documentReceipt/);
assert.match(sync, /BlindCloseReport/);

const flow = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shift/BlindCloseFlow.java",
);
assert.match(flow, /askCountedCash|blind_close_count/);
assert.match(flow, /printShiftReport/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-z-report-form-checklist/);

console.log("OK test-npos-z-report-form");
