/**
 * Gate: friendly Prompt type + compact buttons (settings / clock-in / sell).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 291/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 86/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+56/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.33"/);

assert.ok(existsSync(join(root, "docs/npos-friendly-ui-checklist.md")));
assert.match(read("docs/npos-friendly-ui-checklist.md"), /Prompt|1\.14\.33/);

assert.ok(existsSync(join(root, "npos-telltea/app/src/main/res/font/prompt_regular.ttf")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/res/font/prompt_semibold.ttf")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/assets/fonts/Prompt-Regular.ttf")));
assert.ok(existsSync(join(root, "npos-telltea/third_party/prompt/OFL.txt")));

assert.match(read("npos-telltea/app/src/main/AndroidManifest.xml"), /Theme\.Npos/);
assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /name="Npos"/);
assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /Npos\.Btn\.Primary/);
assert.match(read("npos-telltea/app/src/main/res/values/styles.xml"), /prompt_semibold|prompt_bold/);
assert.match(read("npos-telltea/app/src/main/res/values/colors.xml"), /npos_orange/);

const fonts = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/ui/NposFonts.java",
);
assert.match(fonts, /applyActivity|prompt_regular|assets\/fonts/);

const ui = read("npos-telltea/app/src/main/java/app/telltea/npos/ui/UiScale.java");
assert.match(ui, /52 \* density \* scale/);
assert.match(ui, /44 \* density \* scale/);

const settings = read("npos-telltea/app/src/main/res/layout/activity_settings.xml");
assert.match(settings, /Npos\.Btn\.Primary/);
assert.match(settings, /Npos\.Btn\.Chip/);
assert.match(settings, /npos_banner_peach|Npos\.Banner\.Update/);
assert.match(settings, /HorizontalScrollView/);
assert.doesNotMatch(settings, /<Button\b/);

const settingsJava = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java",
);
assert.match(settingsJava, /NposFonts\.applyActivity/);
assert.match(settingsJava, /TextView updateButton/);
assert.doesNotMatch(settingsJava, /import android\.widget\.Button/);

const main = read("npos-telltea/app/src/main/res/layout/activity_main.xml");
assert.match(main, /Npos\.Btn\.Primary/);
assert.match(main, /prompt_bold|npos_text_brand/);

const sell = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(sell, /payCashButton[\s\S]*Npos\.Btn\.Primary/);

assert.match(
  read("npos-telltea/app/src/main/java/app/telltea/npos/shell/PosShellNav.java"),
  /NposFonts/,
);

console.log("OK test-npos-friendly-ui");
