/**
 * Gate: Gpos sell chrome — hub grid + slim cart (−/qty/+).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 526/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 145/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+114/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.91"/);

assert.ok(existsSync(join(root, "docs/npos-gpos-chrome-checklist.md")));
assert.match(read("docs/npos-gpos-chrome-checklist.md"), /1\.14\.54|กริด|ตะกร้า/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /sellHubButton/);
assert.match(layout, /sellSearch/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /sell_hub_menu|sell_search_hint|sell_hub_glyph/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showSellHubMenu|hideSidebar/);
assert.match(sell, /UiScale\.from\(this,\s*false\)/);
assert.match(sell, /menuQuery/);
assert.match(sell, /renderCartViewsOnly/);
assert.match(sell, /"−"|\"\+\"/);

const nav = read("npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java");
assert.match(nav, /hideSidebar|openReceipts|openShift|openSettings|openOpenBillsHint/);

const ui = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java");
assert.match(ui, /subtractNav/);

console.log("ok: npos-gpos-chrome gate");
