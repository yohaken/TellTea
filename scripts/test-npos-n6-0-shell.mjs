/**
 * nPos N6.0 — sell shell + auto health + compact ops table.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 212/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+9/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.7\.0"/);
assert.match(read("docs/npos-migration-phases.md"), /N6\.0.*✅|✅ รอบนี้ \(1\.7\.0\)/);

assert.match(read("src/components/NposOpsLogPanel.tsx"), /npos-ops-table/);
assert.match(read("src/app/globals.css"), /\.npos-ops-table/);

assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/AutoHealth.java")),
);
assert.ok(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/shift/ShiftPrefs.java")),
);
assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/MainActivity.java"),
  /ShiftPrefs|AutoHealth|openShift/,
);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_main.xml"), /clockInPanel|sellPanel/);
assert.match(
  read("npos-telltea/app/src/main/res/layout/activity_settings.xml"),
  /settings_section_tech|settings_section_device/,
);
assert.match(read("npos-telltea/app/src/main/res/values/strings.xml"), /btn_open_shift/);

console.log("OK test-npos-n6-0-shell");
