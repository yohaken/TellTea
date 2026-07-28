/**
 * Customer display: cart-full while ordering; paid review after success (option C).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 327/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 119/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+90/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.67"/);
assert.ok(existsSync(join(root, "docs/npos-customer-focus-checklist.md")));
assert.ok(existsSync(join(root, "docs/npos-version-prod-verify-checklist.md")));

const ctrl = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayController.java",
);
assert.match(ctrl, /PAID_REVIEW_MS\s*=\s*12000L/);
assert.match(ctrl, /showPaidReview/);
assert.match(ctrl, /stopRotate/);
assert.match(ctrl, /cart-first|Cart is primary|collapse promo/i);

const pres = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/diagnose/CustomerDisplayPresentation.java",
);
assert.match(pres, /PAID_REVIEW/);
assert.match(pres, /setCartFocus\(true\)/);
assert.match(pres, /showPaidReview/);
assert.match(pres, /customer_paid_review_title/);
assert.match(pres, /paneMedia\.setVisibility\(View\.GONE\)/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /customer_paid_review_title/);

const sell = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java",
);
assert.match(sell, /optionsLines\(\)/);
assert.match(sell, /String\.join\("\\n"/);

const prodDoc = read("docs/npos-version-prod-verify-checklist.md");
assert.match(prodDoc, /smoke-pos-install-live/);
assert.match(prodDoc, /latest\.json/);

console.log("OK test-npos-customer-focus");
