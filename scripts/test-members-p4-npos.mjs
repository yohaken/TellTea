/**
 * Guard: members P4 — nPos member lookup + redeem before cash/transfer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const memberApi = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MemberApi.java");
assert.match(memberApi, /nposMemberLookup/);
assert.match(memberApi, /nposMemberQuickCreate/);
assert.match(memberApi, /redeemBahtFromPoints/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /manualDiscountBaht/);
assert.match(saleSync, /pointsToRedeem/);
assert.match(saleSync, /memberId/);
assert.match(saleSync, /MemberApi\.redeemBahtFromPoints/);

const hold = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/HoldCart.java");
assert.match(hold, /KEY_MEMBER_ID/);
assert.match(hold, /memberId/);
assert.doesNotMatch(hold, /pointsToRedeem/);

const sell = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sell, /showMemberDialog/);
assert.match(sell, /showRedeemDialog/);
assert.match(sell, /pay_zero_title/);
assert.match(sell, /pointsToRedeem/);
assert.match(sell, /enqueueSale\([\s\S]*mid[\s\S]*pts/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /manualDiscountBaht: body\.manualDiscountBaht/);

const gradle = read("npos-telltea/app/build.gradle");
const ver = gradle.match(/versionCode\s+(\d+)/);
assert.ok(ver && Number(ver[1]) >= 138, "versionCode >= 138");

const apkPin = read("src/lib/npos-apk-release.ts");
assert.match(apkPin, /NPOS_SYSTEM_VERSION_CODE = 138/);

const whats = read("npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java");
assert.match(whats, /versionCode == 138/);
assert.match(whats, /สมาชิกและใช้แต้ม/);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /sell_hub_member/);
assert.match(strings, /sell_hub_redeem/);
assert.match(strings, /pay_zero_confirm/);

const layout = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(layout, /memberButton/);
assert.match(layout, /redeemButton/);
assert.match(layout, /memberStatusLabel/);

const phases = read("docs/members-round-phases.md");
assert.match(phases, /P4/);

const appBuild = Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]);
assert.ok(appBuild >= 740, "APP_BUILD >= 740");
const posBuild = Number(read("src/lib/pos-version.ts").match(/POS_BUILD = (\d+)/)[1]);
assert.ok(posBuild >= 190, "POS_BUILD >= 190");

console.log("OK test-members-p4-npos");
