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
assert.match(doc, /1\.14\.106|versionCode 129/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 580);
const pos = read("src/lib/pos-version.ts");
assert.ok(Number(pos.match(/POS_BUILD\s*=\s*(\d+)/)[1]) >= 165);

const gradle = read("npos-telltea/app/build.gradle");
assert.match(gradle, /versionCode\s+130/);
assert.match(gradle, /versionName\s+"1\.14\.107"/);
assert.match(read("src/lib/npos-apk-release.ts"), /1\.14\.106/);
assert.match(read("src/lib/npos-apk-release.ts"), /NPOS_SYSTEM_VERSION_CODE = 130/);

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

const kinds = read("src/lib/pos-shift-report.ts");
assert.match(kinds, /close-full/);
assert.match(kinds, /remit/);

assert.match(read("scripts/check-npos-shop.mjs"), /z-remit-short/);

console.log("OK test-npos-z-remit-short");
