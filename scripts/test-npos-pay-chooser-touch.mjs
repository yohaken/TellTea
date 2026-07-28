/**
 * Gate: pay method chooser must be large NposUi buttons — not AlertDialog.setItems.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 321/);
assert.match(read("src/lib/pos-version.ts"), /POS_BUILD = 116/);
assert.match(read("npos-telltea/app/build.gradle"), /versionCode\s+86/);
assert.match(read("npos-telltea/app/build.gradle"), /versionName\s+"1.14.63"/);

assert.ok(existsSync(join(root, "docs/npos-pay-chooser-touch-checklist.md")));
assert.ok(existsSync(join(root, "docs/npos-friendly-ui-checklist.md")));
assert.match(read("docs/npos-friendly-ui-checklist.md"), /setItems/);
assert.match(read("docs/npos-pay-chooser-touch-checklist.md"), /NposUi|setItems/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /pay_choose_title/);
assert.match(strings, /pay_choose_hint/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
const startPayAll = sell.match(/private void startPayAll\(\) \{[\s\S]*?\n  private void startPay\(/);
assert.ok(startPayAll, "startPayAll method missing");
const body = startPayAll[0];
assert.doesNotMatch(body, /\.setItems\s*\(/);
assert.doesNotMatch(body, /setPositiveButton|setNegativeButton|setNeutralButton/);
assert.match(body, /NposUi\.primary/);
assert.match(body, /NposUi\.secondary/);
assert.match(body, /NposUi\.ghost/);
assert.match(body, /pay_choose_hint/);
assert.match(body, /startPay\("cash"\)/);
assert.match(body, /PaymentMethods\.TRANSFER|startPay\(PaymentMethods\.TRANSFER\)/);
assert.match(body, /payPrimaryMinPx/);

assert.match(read(".cursor/rules/npos-friendly-ui.mdc"), /setItems/);

console.log("OK test-npos-pay-chooser-touch");
