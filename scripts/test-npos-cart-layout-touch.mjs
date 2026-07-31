/**
 * Gate: cart ~35% X, text action row, tall pay bar, friendly back taps.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 548/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 159/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+127/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.104"/);

assert.ok(existsSync(join(root, "docs/npos-cart-layout-touch-checklist.md")));

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /layout_weight="14"/);
assert.match(layout, /layout_weight="51"/);
assert.match(layout, /layout_weight="35"/);
assert.match(layout, /cartActionRow/);
assert.match(layout, /discountButton[\s\S]*sell_hub_discount/);
assert.match(layout, /restoreHoldButton[\s\S]*sell_hub_restore_hold/);
assert.match(layout, /clearCartButton[\s\S]*sell_hub_clear_cart/);
assert.match(layout, /clearCartButton[\s\S]*npos_orange/);
assert.match(layout, /cartPayBar[\s\S]*layout_weight="18"/);
assert.match(layout, /ScrollView[\s\S]*layout_weight="82"/);
assert.doesNotMatch(layout, /layout_weight="70"/);
assert.doesNotMatch(layout, /layout_weight="16"/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /styleCartTextAction/);
assert.doesNotMatch(sell, /sell_hub_discount/);
assert.doesNotMatch(sell, /popup\.getMenu\(\)\.add\(0, 10/);

const ui = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/NposUi.java");
assert.match(ui, /case BACK:[\s\S]*?setMinHeight\(dp\(context, 52\)\)/);
assert.match(ui, /npos_touch_secondary/);

const styles = read("npos-telltea/app/src/main/res/values/styles.xml");
assert.match(styles, /Npos\.Btn\.Back[\s\S]*minHeight">52dp/);

const picker = read("npos-telltea/app/src/main/res/layout/dialog_option_picker.xml");
assert.match(picker, /optionCancel[\s\S]*Npos\.Btn\.Back/);
assert.match(picker, /btn_back/);

const scale = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java");
assert.match(scale, /72 \* density \* scale/);

console.log("OK test-npos-cart-layout-touch");
