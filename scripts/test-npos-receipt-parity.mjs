/**
 * Gate: native customer receipt form parity with web receipt-template.
 * (No TS runtime import — string/structure asserts only.)
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 267/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 76/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+46/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.23"/);

assert.ok(existsSync(join(root, "docs/npos-receipt-parity-checklist.md")));
const doc = read("docs/npos-receipt-parity-checklist.md");
assert.match(doc, /1.14.23/);
assert.match(doc, /ReceiptFormBuilder/);
assert.match(doc, /documentReceipt/);
assert.match(doc, /ไม่พิมพ์ badge|ไม่มี.*badge/);

const javaBuilder = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
for (const token of [
  "ใบเสร็จ",
  "ยอดสุทธิ",
  "TellTea POS",
  "ขอบคุณที่อุดหนุน",
  "shopNameTh",
  "shopAddress",
  "shopPhone",
  "receiptFooterNote",
  "วันที่",
  "เวลา",
  "ส่วนลด",
  "เงินสด",
  "เงินทอน",
  "PromptPay",
  "COLS_80",
  "COLS_58",
]) {
  assert.match(javaBuilder, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(javaBuilder, /Front-counter only/);
assert.doesNotMatch(javaBuilder, /"ทานที่ร้าน"|"รับกลับ"|"ShopeeFood"/);

const esc = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java");
assert.match(esc, /documentReceipt/);
assert.match(esc, /saleReceipt/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /ReceiptFormBuilder/);
assert.match(saleSync, /documentReceipt/);
assert.match(saleSync, /provisionalBillNo/);
assert.match(saleSync, /markReceiptPrinted/);
assert.match(saleSync, /isReceiptPrinted/);
assert.match(saleSync, /receiptPrinted/);
assert.match(saleSync, /subtotal/);
assert.match(saleSync, /cashReceived/);

const webTpl = read("src/lib/pos-printer/receipt-template.ts");
assert.match(webTpl, /buildUnifiedReceiptBody/);
assert.match(webTpl, /Front-counter only|never print dine-in/);
assert.match(webTpl, /ยอดสุทธิ/);
assert.match(webTpl, /TellTea POS/);

const textForm = read("src/lib/pos-printer/receipt-text-form.ts");
assert.match(textForm, /buildUnifiedReceiptText/);
assert.match(textForm, /ยอดสุทธิ:/);
assert.match(textForm, /RECEIPT_TEXT_COLS_80/);
assert.match(read("src/lib/pos-printer/index.ts"), /buildUnifiedReceiptText/);

// Shared label tokens must appear in both web HTML template and native builder.
const sharedLabels = ["ใบเสร็จ", "ยอดสุทธิ", "จำนวน:", "ส่วนลด", "ชำระ", "เงินสด", "เงินทอน", "TellTea POS"];
for (const label of sharedLabels) {
  assert.match(webTpl, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(javaBuilder, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(textForm, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-receipt-parity-checklist/);
assert.match(remaining, /1.14.23/);

console.log("OK test-npos-receipt-parity");
