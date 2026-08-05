/**
 * nPos hub nav + back buttons (counter-only native tiles).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 581);
assert.ok(Number((read("npos-telltea/app/build.gradle").match(/versionCode\s+(\d+)/) || [])[1]) >= 130);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"\d+"/);

const main = read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java");
assert.match(main, /buildHubNav/);
assert.match(main, /nav_sell|nav_menu|nav_receipts|nav_shift/);
assert.match(main, /PosShellNav\.openMenuAdmin|MenuAdminActivity/);
assert.doesNotMatch(main, /addHubWeb|openWeb\(/);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java"),
  /openMenuAdmin|MenuAdminActivity/,
);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_main.xml"), /hubNavList/);
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/ShiftActivity.java")));
assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /ShiftActivity/);
assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /MenuAdminActivity/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /nav_menu/);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /menu_admin_title/);

assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /backButton/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_settings.xml"), /backButton/);
assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java"), /backButton/);
assert.match(read("docs/npos-cut-bo-entry-checklist.md"), /buildHubNav|Native hub/);

console.log("OK test-npos-hub-nav");
