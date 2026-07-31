/**
 * Gate: cash-change hold — countdown, ✕ / tap-elsewhere dismiss, last-change chip, hub shortcut.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 536/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 150/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+119/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.96"/);

assert.ok(existsSync(join(root, "docs/npos-change-display-setting-checklist.md")));
assert.match(read("docs/npos-change-display-setting-checklist.md"), /1\.14\.96/);
assert.match(read("docs/npos-change-display-setting-checklist.md"), /ทอนล่าสุด|✕|10/);

const prefs = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/ChangeDisplayPrefs.java",
);
assert.match(prefs, /MANUAL\s*=\s*-1/);
assert.match(prefs, /DEFAULT_SECONDS\s*=\s*10/);
assert.match(prefs, /holdMsForChange/);
assert.match(prefs, /cycleNext/);

const ctrl = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayController.java",
);
assert.match(ctrl, /ChangeDisplayPrefs\.holdMsForChange/);
assert.match(ctrl, /dismissChangeHold/);
assert.match(ctrl, /awaitingManualDismiss/);

const settings = read("npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java");
assert.match(settings, /changeDisplayCycleButton|ChangeDisplayPrefs\.cycleNext/);
assert.match(settings, /refreshChangeDisplaySetting/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_settings.xml");
assert.match(layout, /settings_section_payment/);
assert.match(layout, /changeDisplayCycleButton/);
assert.match(layout, /change_display_title/);

const sellLayout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(sellLayout, /changeHoldBar/);
assert.match(sellLayout, /changeHoldDismiss/);
assert.match(sellLayout, /change_hold_dismiss_x/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showChangeHoldBar/);
assert.match(sell, /dismissChangeHoldUi/);
assert.match(sell, /pinLastChangeStatus/);
assert.match(sell, /sell_last_change_fmt/);
assert.match(sell, /sell_hub_change_display_fmt/);
assert.match(sell, /ACTION_DOWN/);
assert.match(sell, /changeHoldTickTask|refreshChangeHoldLabels/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /change_display_manual/);
assert.match(strings, /change_hold_dismiss_x/);
assert.match(strings, /sell_last_change_fmt/);
assert.match(strings, /sell_hub_change_display_fmt/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-change-display-setting-checklist/);
assert.match(read("scripts/check-npos-shop.mjs"), /change-display-setting/);

console.log("OK test-npos-change-display-setting");
