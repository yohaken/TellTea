/**
 * Gate: sell-flow polish F0–F4 wiring (dine-in cut, clear cart, PromptPay CTA).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 242/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+35/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.12"/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 64/);

assert.ok(existsSync(join(root, "docs/npos-sell-flow-polish-checklist.md")));
const doc = read("docs/npos-sell-flow-polish-checklist.md");
assert.match(doc, /F0|ตัด.*ทานที่ร้าน/);
assert.match(doc, /ล้างตะกร้า/);
assert.match(doc, /1\.14\.12/);

const sell = read("src/components/PosSellView.tsx");
assert.doesNotMatch(sell, /pos-cart-channel|>\s*ทานที่ร้าน\s*</);
assert.doesNotMatch(sell, /เพิ่มบัตรสะสมคะแนน|ส่งค้างไว้/);
assert.match(sell, /ล้างตะกร้า|confirmClearCart/);
assert.match(sell, /openPromptPayPay/);
assert.match(sell, /เงินสด/);

const receipts = read("src/components/PosReceiptsView.tsx");
assert.doesNotMatch(receipts, /pos-receipts-channel-tabs|ทานที่ร้าน/);

const paper = read("src/components/PosReceiptPaper.tsx");
assert.doesNotMatch(paper, /ทานที่ร้าน/);

const nav = read("src/lib/pos-nav.ts");
assert.doesNotMatch(nav, /href: "\/pos\/members\/"/);

const shell = read("npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java");
assert.doesNotMatch(shell, /nav_members/);

const sellAct = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sellAct, /confirmClearCart|clearCartButton/);
assert.match(sellAct, /editCartLineOptions|showOptionPicker\(item, /);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /clearCartButton/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-sell-flow-polish-checklist/);

console.log("OK test-npos-sell-flow-polish");
