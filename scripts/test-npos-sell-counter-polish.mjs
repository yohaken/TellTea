/**
 * Gate: front-counter sell polish — no delivery channel, cart totals, hold badge, PP parked.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 542/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 154/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+123/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.100"/);

assert.ok(existsSync(join(root, "docs/npos-sell-counter-polish-checklist.md")));
const doc = read("docs/npos-sell-counter-polish-checklist.md");
assert.match(doc, /1\.14\.42/);
assert.match(doc, /P-PP|PromptPay/);
assert.match(doc, /ตัด.*ส่ง|delivery|หน้าร้านล้วน/);
assert.match(doc, /C0|C1|C2|C3|C4/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.doesNotMatch(layout, /priceChannelToggle/);
assert.match(layout, /cartBillRef/);
assert.match(layout, /cartSubtotal/);
assert.match(layout, /cart_subtotal_label|cartSubtotal/);
assert.match(layout, /payPromptButton[\s\S]*visibility="gone"/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.doesNotMatch(sell, /deliveryChannel|togglePriceChannel|priceChannelToggle/);
assert.match(sell, /cartSubtotalView|cartBillRef/);
assert.match(sell, /btn_restore_hold_ready/);
assert.match(sell, /item\.price/);
assert.match(sell, /payPp[\s\S]*GONE|payPromptButton[\s\S]*GONE|setVisibility\(View\.GONE\)/);

const web = read("src/components/PosSellView.tsx");
assert.doesNotMatch(web, /pos-sell-channel|applyPriceChannel/);
assert.doesNotMatch(web, />\s*ส่ง\s*</);
assert.match(web, /priceChannel:\s*MenuPriceChannel\s*=\s*"store"|const priceChannel.*store/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-sell-counter-polish-checklist/);

console.log("OK test-npos-sell-counter-polish");
