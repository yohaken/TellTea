/**
 * nPos N6.6 — web sell parity (images, options, discount, QR, sold-out, reprint, Z).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 237/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+30/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1\.14\.7"/);
assert.match(read("docs/npos-migration-phases.md"), /N6\.6/);
assert.match(read("docs/npos-n6-plan.md"), /N6\.6/);

assert.match(read("functions/npos-sell.js"), /imageUrl/);
assert.match(read("functions/npos-sell.js"), /minSelect/);
assert.match(read("functions/npos-sell.js"), /recommended/);
assert.match(read("docs/npos-parity-checklist.md"), /P0/);
assert.match(read("functions/npos-sell.js"), /nposToggleSoldOut/);
assert.match(read("functions/npos-sell.js"), /menuItems\/\$\{itemId\}/);
assert.match(read("functions/index.js"), /nposToggleSoldOut/);

const menuModels = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuModels.java");
assert.match(menuModels, /imageUrl/);
assert.match(menuModels, /selectionType/);

assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/ImageLoader.java")));
assert.ok(existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/PromptPayPayload.java")));

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /ImageLoader/);
assert.match(sell, /showOptionPicker/);
assert.match(sell, /showDiscountDialog/);
assert.match(sell, /showPromptPayDialog/);
assert.match(sell, /PromptPayPayload/);
assert.match(sell, /confirmToggleSoldOut/);
assert.match(sell, /reloadMenu/);
assert.match(sell, /effectiveMin|option_min/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /reprintReceipt/);
assert.match(saleSync, /printShiftReport/);

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/ReceiptsActivity.java"), /reprintReceipt/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /discountButton/);

const pp = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/PromptPayPayload.java");
assert.doesNotMatch(pp, /charCodeAtSafe/);
assert.match(pp, /charAt/);

console.log("OK test-npos-n6-6-parity");

assert.match(read("npos-telltea/app/src/main/java/app/telltea/npos/SettingsActivity.java"), /openMenuAdminPage/);
assert.match(read("npos-telltea/app/src/main/res/layout/activity_sell.xml"), /refreshMenuButton/);
