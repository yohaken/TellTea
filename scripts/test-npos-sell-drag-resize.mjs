/**
 * Gate: user-draggable sell X splitters with ≤35% side caps + smart pane scale.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 555/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 161/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+128/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.105"/);

assert.ok(existsSync(join(root, "docs/npos-sell-drag-resize-checklist.md")));
assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/SellLayoutPrefs.java"),
  ),
);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SellLayoutPrefs.java",
);
assert.match(prefs, /SIDE_MAX\s*=\s*35f/);
assert.match(prefs, /MENU_MIN\s*=\s*30f/);
assert.match(prefs, /CAT_DEFAULT\s*=\s*14f/);
assert.match(prefs, /CART_DEFAULT\s*=\s*35f/);
assert.match(prefs, /adjustCat|adjustCart/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /android:id="@\+id\/sellContentRow"/);
assert.match(layout, /android:id="@\+id\/splitCatMenu"/);
assert.match(layout, /android:id="@\+id\/splitMenuCart"/);
assert.match(layout, /android:id="@\+id\/cartColumn"/);
assert.match(layout, /layout_weight="14"/);
assert.match(layout, /layout_weight="51"/);
assert.match(layout, /layout_weight="35"/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /SellLayoutPrefs/);
assert.match(sell, /bindSellSplitters/);
assert.match(sell, /applySellPaneWeights/);
assert.match(sell, /applyPaneSmartScale/);
assert.match(sell, /makeSplitterListener/);

const scale = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java");
assert.match(scale, /menuColsForWidth/);

console.log("OK test-npos-sell-drag-resize");
