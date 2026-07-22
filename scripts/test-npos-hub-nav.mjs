/**
 * nPos hub nav + back buttons (clone web POS_NAV_ITEMS).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 242/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+34/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.11"/);

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /buildHubNav/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"), /nav_menu/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_main.xml"), /hubNavList/);
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java")));
assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /ShiftActivity/);

assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /backButton/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_settings.xml"), /backButton/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"), /backButton/);
assert.match(read("docs/npos-parity-checklist.md"), /Hub เมนูครบเว็บ/);

console.log("OK test-npos-hub-nav");
