/**
 * Gate: shop-brand documents + cash-drawer policy.
 * Paper uses our shop (TELL TEA) — never competitor POS brands.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 364/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 124/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+95/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.72"/);

assert.ok(existsSync(join(root, "docs/npos-doc-drawer-polish-checklist.md")));
const polishDoc = read("docs/npos-doc-drawer-polish-checklist.md");
assert.match(polishDoc, /1.14.42/);
assert.match(polishDoc, /CashDrawerPolicy/);
assert.match(polishDoc, /TELL TEA/);
assert.match(polishDoc, /Wongnai/);

const receiptJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.doesNotMatch(receiptJava, /TellTea POS/);
assert.doesNotMatch(receiptJava, /["']Wongnai["']|["']FoodStory["']/i);
assert.match(receiptJava, /DEFAULT_SHOP_EN = "TELL TEA"/);
assert.match(receiptJava, /DEFAULT_SHOP_TH = "เทล ที"/);
assert.match(receiptJava, /Shop-only document|no system\/product brand/);

const shiftJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ShiftReportFormBuilder.java",
);
assert.doesNotMatch(shiftJava, /TellTea POS/);
assert.doesNotMatch(shiftJava, /["']Wongnai["']|["']FoodStory["']/i);
assert.match(shiftJava, /DEFAULT_SHOP_EN = "TELL TEA"/);

const esc = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java");
assert.match(esc, /documentReceipt/);
assert.match(esc, /saleReceipt/);
assert.match(esc, /PRINTER TEST/);
assert.doesNotMatch(esc, /parts\.add\(text\("TellTea\\n"\)\)/);
assert.doesNotMatch(esc, /["']Wongnai["']|["']FoodStory["']/i);
assert.match(esc, /return documentReceipt\(body\)/);

const policy = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/CashDrawerPolicy.java",
);
assert.match(policy, /shouldKickAfterSale/);
assert.match(policy, /shouldKickOnReprint/);
assert.match(policy, /shouldKickAfterShiftReport/);
assert.match(policy, /return "cash"\.equals|PaymentMethods\.isCash/);
assert.match(policy, /return false/);
assert.match(policy, /No Sale|เปิดลิ้นชัก/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /CashDrawerPolicy\.shouldKickAfterSale/);
assert.match(sync, /CashDrawerPolicy\.shouldKickOnReprint/);
assert.match(sync, /kickDrawer/);

const webTpl = read("src/lib/pos-printer/receipt-template.ts");
assert.doesNotMatch(webTpl, /TellTea POS/);
assert.doesNotMatch(webTpl, /["']Wongnai["']|["']FoodStory["']/i);
assert.match(webTpl, /shopName: "TELL TEA"/);
assert.match(webTpl, /footerNote/);

const webText = read("src/lib/pos-printer/receipt-text-form.ts");
assert.doesNotMatch(webText, /TellTea POS/);
assert.doesNotMatch(webText, /["']Wongnai["']|["']FoodStory["']/i);
assert.match(webText, /shopName: "TELL TEA"/);

const shiftWeb = read("src/lib/pos-printer/shift-snapshot-template.ts");
assert.doesNotMatch(shiftWeb, /["']Wongnai["']|["']FoodStory["']|TellTea POS/i);
assert.match(shiftWeb, /TELL TEA/);
assert.match(shiftWeb, /เทล ที/);

const shiftPayload = read("src/lib/pos-shift-report.ts");
assert.match(shiftPayload, /TELL TEA/);
assert.match(shiftPayload, /เทล ที/);
assert.doesNotMatch(shiftPayload, /["']Wongnai["']|["']FoodStory["']/i);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-doc-drawer-polish-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /doc-drawer-polish/);

console.log("OK test-npos-doc-drawer-polish");
