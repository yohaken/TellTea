/**
 * Option confirm jumps to required group; cart wraps options vertically.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 543/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 155/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+124/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.101"/);
assert.ok(existsSync(join(root, "docs/npos-option-cart-wrap-checklist.md")));

const sell = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java",
);
assert.match(sell, /jumpToOptionGroup/);
assert.match(sell, /setSmoothScrollingEnabled\(false\)/);
assert.match(sell, /groupAnchors/);
assert.match(sell, /option_required/);
assert.match(sell, /optionsLines\(\)/);
assert.match(sell, /setEllipsize\(null\)/);
assert.match(sell, /setSingleLine\(false\)/);

const models = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuModels.java",
);
assert.match(models, /optionsLines\(\)/);
assert.match(models, /" x" \+/);
assert.match(models, /LinkedHashMap/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /option_required/);

console.log("OK test-npos-option-cart-wrap");
