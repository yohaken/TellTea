/**
 * W1–W5 shop phases: check harness + cart options + layout + outbox + void.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 251/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+42/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.19"/);

assert.ok(existsSync(join(root, "docs/npos-shop-work-checklist.md")));
assert.match(read("docs/npos-shop-work-checklist.md"), /W1|W2|W3|W4|W5/);
assert.match(read("docs/npos-shop-work-checklist.md"), /check-npos-shop/);
assert.ok(existsSync(join(root, "scripts/check-npos-shop.mjs")));

const check = read("scripts/check-npos-shop.mjs");
assert.match(check, /test-npos-outbox/);
assert.match(check, /test-npos-void-server/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /layout_weight="65"|layout_weight="35"/);
assert.doesNotMatch(layout, /android:layout_width="344dp"/);

const menuModels = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/MenuModels.java",
);
assert.match(menuModels, /optionsSummary/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /optionsSummary/);
assert.match(sell, /showPendingOutboxDialog/);

const present = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayPresentation.java",
);
assert.match(present, /detail|optionsSummary|line\.detail/);

const saleSync = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java",
);
assert.match(saleSync, /options|optString\("options"|choices/);
assert.match(saleSync, /VOID_URL|nposVoidSale/);

assert.match(read("docs/npos-remaining-checklist.md"), /W4|W5|1\.14\.4/);

console.log("OK test-npos-shop-phases");
