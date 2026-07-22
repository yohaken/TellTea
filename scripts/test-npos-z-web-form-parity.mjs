/**
 * Gate: native Z/X shift bill clones web buildShiftReportHtml frame order.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 266/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 76/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+46/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.23"/);

assert.ok(existsSync(join(root, "docs/npos-z-web-form-parity-checklist.md")));
assert.match(read("docs/npos-z-web-form-parity-checklist.md"), /1\.14\.23/);

const web = read("src/lib/pos-printer/shift-snapshot-template.ts");
assert.match(web, /รายงานยอดการขาย/);
assert.match(web, /Snapshot ระหว่างรอบการขาย/);
assert.match(web, /รอบการขาย \(เงินสด\)/);
assert.match(web, /openingCash|closingCashCounted/);
assert.doesNotMatch(web, /ทานที่ร้าน/);
assert.match(web, /ลงชื่อผู้ส่งกะ/);

const builder = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
for (const token of [
  "รายงานยอดการขาย",
  "Snapshot ระหว่างรอบการขาย",
  "รหัสเครื่อง",
  "เปิดรอบ",
  "ปิดรอบ",
  "สรุปยอด",
  "ยอดขายสุทธิ",
  "ส่วนลด & โปรโมชั่น",
  "ยอดขายตามการชำระเงิน",
  "รอบการขาย (เงินสด)",
  "เงินสดเริ่มต้น",
  "นับจริงในลิ้นชัก",
  "ทำลายบิล / ยกเลิก",
  "บิลรอส่ง",
  "รายการขายแยกตามบิล",
  "ปิดรอบเรียบร้อย",
  "ลงชื่อผู้ส่งกะ",
  "ลงชื่อผู้รับกะ",
  "ไม่ใช่การปิดรอบ",
]) {
  assert.match(builder, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(builder, /"ทานที่ร้าน"|"Lineman"|"Grab"|Delivery|Z-REPORT|X-REPORT/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /loadSessionReceipts/);
assert.match(sync, /pairingCode/);
assert.match(sync, /ShiftReportFormBuilder\.build/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-z-web-form-parity-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /z-web-form-parity/);

console.log("OK test-npos-z-web-form-parity");
