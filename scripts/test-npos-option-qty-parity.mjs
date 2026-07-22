/**
 * nPos option qty-per-option — frame parity with web PosOptionPickerModal.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 244/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+35/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.12"/);
assert.match(read("docs/npos-option-qty-parity-checklist.md"), /qty-per-option|steppers|ความหวาน/);
assert.match(read("docs/npos-remaining-checklist.md"), /N7.*ไม่ทำ|ไม่ทำ.*N7|ตัดออกตามนโยบาย/);

assert.ok(
  existsSync(
    join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/OptionPickerLogic.java"),
  ),
);
const logic = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/OptionPickerLogic.java",
);
assert.match(logic, /isSweetnessGroup/);
assert.match(logic, /usesQuantitySteppers/);
assert.match(logic, /MAX_UNITS_PER_CHOICE/);
assert.match(logic, /parseSweetnessPercent/);

const web = read("src/components/PosOptionPickerModal.tsx");
assert.match(web, /groupUsesQuantitySteppers/);
assert.match(web, /isSweetnessGroup/);
assert.match(web, /pos-option-stepper/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /OptionPickerLogic/);
assert.match(sell, /usesQuantitySteppers|isSweetnessGroup/);
assert.match(sell, /option_confirm_fmt|btn_option_confirm/);
assert.match(sell, /MAX_UNITS_PER_CHOICE|counts\.put/);

const layout = read("npos-telltea/app/src/main/res/layout/dialog_option_picker.xml");
assert.match(layout, /optionHeroImage/);
assert.match(layout, /optionQtyPlus/);
assert.match(layout, /optionConfirm/);
assert.match(layout, /npos_touch_primary/);

console.log("OK test-npos-option-qty-parity");
