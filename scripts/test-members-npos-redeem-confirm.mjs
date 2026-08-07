/**
 * Guard: nPos member lookup → confirm balance → use / skip → redeem amount.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /offerMemberAfterLookup/);
assert.match(sell, /member_found_title/);
assert.match(sell, /member_found_use/);
assert.match(sell, /member_found_skip/);
assert.match(sell, /showRedeemDialog\(\)/);
assert.doesNotMatch(
  sell,
  /applyMemberFromJson\(res\.optJSONObject\("member"\)\);\s*\n\s*if \(!hasMember\(\)\) \{\s*\n\s*status\.setText\(R\.string\.member_suspended\)/,
);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /member_found_ask_fmt/);
assert.match(strings, /member_found_zero_fmt/);
assert.match(strings, /redeem_use_max_fmt/);
assert.match(strings, /redeem_balance_fmt/);

const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 141);

const pin = read("src/lib/npos-apk-release.ts");
assert.ok(Number(pin.match(/NPOS_SYSTEM_VERSION_CODE = (\d+)/)[1]) >= 141);

const whats = read("npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java");
assert.match(whats, /versionCode == 141/);

const ux = read("docs/members-npos-pay-ux.md");
assert.match(ux, /1b คอนเฟิร์มแต้ม/);

console.log("OK test-members-npos-redeem-confirm");
