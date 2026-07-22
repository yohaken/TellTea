/**
 * nPos smart UI scale — vertical menu grid, pay CTA size, sidebar auto-scale, version chip.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 259/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+46/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.23"/);
assert.match(read("docs/npos-smart-ui-scale-checklist.md"), /UiScale|เลื่อน|คิดเงิน|เวอร์ชัน/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java")),
);
const ui = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java");
assert.match(ui, /REF_SHORT_PX|720/);
assert.match(ui, /navWidthPx/);
assert.match(ui, /payPrimaryMinPx/);
assert.match(ui, /menuMediaMaxPx/);
assert.match(ui, /menuCols/);
assert.match(ui, /touchMinPx/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /UiScale/);
assert.match(sell, /FIT_CENTER/);
assert.match(sell, /menuGrid\.getWidth|renderMenu/);
assert.match(sell, /sellVersion|version_label/);
assert.match(sell, /payPrimaryMinPx|applySmartChrome/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /sellVersion/);
assert.match(layout, /npos_touch_primary/);
assert.match(layout, /menuScroll|scrollbars="vertical"/);
assert.match(layout, /payCashButton/);

const shell = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java",
);
assert.match(shell, /UiScale/);
assert.match(shell, /navWidthPx/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /applyClockInTouchChrome|UiScale/);
assert.match(main, /hubVersion/);

const mainLayout = read("npos-telltea/app/src/main/res/layout/activity_main.xml");
assert.match(mainLayout, /btn_settings_short|npos_touch_primary/);
assert.match(mainLayout, /hubVersion/);
assert.match(mainLayout, /openShiftButton/);

assert.ok(existsSync(join(root, "npos-telltea/app/src/main/res/drawable/npos_touch_primary.xml")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/res/drawable/npos_touch_secondary.xml")));

console.log("OK test-npos-smart-ui-scale");
