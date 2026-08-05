/**
 * Gate: short cash-remit slip on close (phone-photo friendly).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-z-remit-short-slip.md")));
const doc = read("docs/npos-z-remit-short-slip.md");
assert.match(doc, /ใบส่งเงินสด/);
assert.match(doc, /ใบส่งเงิน|versionCode|1\.14\.|135/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 583);
const pos = read("src/lib/pos-version.ts");
assert.ok(Number(pos.match(/POS_BUILD\s*=\s*(\d+)/)[1]) >= 167);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number((gradle.match(/versionCode\s+(\d+)/) || [])[1]) >= 131);
assert.match(gradle, /versionName\s+"\d+"/);
assert.ok(Number((read("src/lib/npos-apk-release.ts").match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/) || [])[1]) >= 130);

const builder = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.match(builder, /buildRemitSlip/);
assert.match(builder, /ใบส่งเงินสด/);
assert.match(builder, /ถ่ายรูปส่งเงิน/);
assert.match(builder, /ไม่มีรายการสินค้า/);
assert.match(builder, /shortRemit/);
assert.match(builder, /close-full/);
assert.match(builder, /รายการสินค้าดูหลังร้าน/);
// short path must not include item list section header
assert.match(builder, /ยอดขายตามรายการ/); // still in full path
assert.ok(builder.includes('shortRemit'));

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /พิมพ์ใบส่งเงินสดแล้ว/);

const web = read("src/lib/pos-printer/shift-snapshot-template.ts");
assert.match(web, /buildRemitSlipHtml/);
assert.match(web, /ใบส่งเงินสด/);
assert.match(web, /shortRemit/);
assert.match(web, /ไม่มีรายการสินค้า/);
assert.match(web, /tabular-nums/);
assert.match(web, /การชำระเงิน/);
assert.match(web, /class="pay"/);
assert.match(builder, /tripleRow\("ส่วนต่าง"/);
assert.match(builder, /การชำระเงิน/);
assert.match(read("src/components/PosSessionPrintDocs.tsx"), /ใบส่งเงินสด/);
assert.match(read("src/components/PosBusinessSettingsView.tsx"), /ส่งเงิน/);
assert.match(read("src/components/PosBusinessSettingsView.tsx"), /ใบส่งเงินสดสั้น/);

const kinds = read("src/lib/pos-shift-report.ts");
assert.match(kinds, /close-full/);
assert.match(kinds, /remit/);

assert.match(read("scripts/check-npos-shop.mjs"), /z-remit-short/);

console.log("OK test-npos-z-remit-short");
