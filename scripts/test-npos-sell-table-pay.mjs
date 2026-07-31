/**
 * nPos sell: vertical category table + cart 35% + text tools + tall pay/hold.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 531/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 148/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+117/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.94"/);
assert.ok(existsSync(join(root, "docs/npos-sell-table-pay-checklist.md")));

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /categoryScroll/);
assert.match(layout, /android:id="@\+id\/categoryBar"/);
assert.match(layout, /android:orientation="vertical"/);
assert.doesNotMatch(layout, /HorizontalScrollView[\s\S]*categoryBar/);
assert.match(layout, /layout_weight="14"/);
assert.match(layout, /layout_weight="51"/);
assert.match(layout, /layout_weight="35"/);
assert.match(layout, /cartActionRow/);
assert.match(layout, /sellSearchButton/);
assert.match(layout, /sellSearch[\s\S]*android:visibility="gone"/);
assert.match(layout, /payAllButton/);
assert.match(layout, /payAllAmount/);
assert.match(layout, /payAllDiscount/);
assert.match(layout, /holdBillButton/);
assert.match(layout, /btn_hold_save|บันทึก/);
assert.match(layout, /layout_weight="85"/);
assert.match(layout, /layout_weight="15"/);
assert.match(layout, /cartPayBar[\s\S]*layout_weight="18"/);
assert.match(layout, /cartTotalsBlock[\s\S]*android:visibility="gone"/);
assert.match(layout, /payCashButton[\s\S]*Npos\.Btn\.(SellRow\.)?Primary/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /btn_pay_all/);
assert.match(strings, /btn_hold_save/);
assert.match(strings, /pay_all_discount_fmt/);
assert.match(strings, /pay_choose_title/);
assert.match(strings, /sell_search_glyph/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /startPayAll/);
assert.match(sell, /payAllAmount/);
assert.match(sell, /toggleSellSearch/);
assert.match(sell, /TextView sellSearchBtn/);
assert.match(sell, /styleCartTextAction/);
assert.match(sell, /holdBill\(\)/);

console.log("OK test-npos-sell-table-pay");
