/**
 * Gate: shop-first documents + cash-drawer policy (no system brand on paper).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 279/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 78/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+48/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.25"/);

assert.ok(existsSync(join(root, "docs/npos-doc-drawer-polish-checklist.md")));
assert.match(read("docs/npos-doc-drawer-polish-checklist.md"), /1\.14\.25/);
assert.match(read("docs/npos-doc-drawer-polish-checklist.md"), /CashDrawerPolicy/);

const receiptJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.doesNotMatch(receiptJava, /TellTea POS/);
assert.match(receiptJava, /Shop-only document|no system\/product brand/);

const esc = read("npos-telltea/app/src/main/java/app/telltea/npos/printer/EscPos.java");
assert.match(esc, /documentReceipt/);
assert.match(esc, /saleReceipt/);
assert.match(esc, /PRINTER TEST/);
assert.doesNotMatch(esc, /parts\.add\(text\("TellTea\\n"\)\)/);
assert.match(esc, /return documentReceipt\(body\)/);

const policy = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/CashDrawerPolicy.java",
);
assert.match(policy, /shouldKickAfterSale/);
assert.match(policy, /shouldKickOnReprint/);
assert.match(policy, /shouldKickAfterShiftReport/);
assert.match(policy, /return "cash"\.equals/);
assert.match(policy, /return false/);

const sync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(sync, /CashDrawerPolicy\.shouldKickAfterSale/);
assert.match(sync, /CashDrawerPolicy\.shouldKickOnReprint/);
assert.match(sync, /kickDrawer/);

const webTpl = read("src/lib/pos-printer/receipt-template.ts");
assert.doesNotMatch(webTpl, /TellTea POS/);
assert.match(webTpl, /footerNote/);

const webText = read("src/lib/pos-printer/receipt-text-form.ts");
assert.doesNotMatch(webText, /TellTea POS/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-doc-drawer-polish-checklist/);

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /doc-drawer-polish/);

console.log("OK test-npos-doc-drawer-polish");
