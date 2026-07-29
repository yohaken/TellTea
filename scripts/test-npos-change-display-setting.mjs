/**
 * Gate: device setting for cash-change display duration / manual dismiss.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 409/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 134/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+105/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.82"/);

assert.ok(existsSync(join(root, "docs/npos-change-display-setting-checklist.md")));
assert.match(read("docs/npos-change-display-setting-checklist.md"), /1\.14\.82/);
assert.match(read("docs/npos-change-display-setting-checklist.md"), /ปิดด้วยตนเอง|MANUAL|10/);

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

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showChangeHoldBar/);
assert.match(sell, /dismissChangeHoldUi/);
assert.match(sell, /change_hold_dismiss|ChangeDisplayPrefs/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /change_display_manual/);
assert.match(strings, /change_hold_dismiss/);

assert.match(read("docs/npos-remaining-checklist.md"), /npos-change-display-setting-checklist/);
assert.match(read("scripts/check-npos-shop.mjs"), /change-display-setting/);

console.log("OK test-npos-change-display-setting");
