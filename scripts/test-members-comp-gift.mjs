/**
 * Guard: QR ให้แต้ม (comp coupon) + customer signup paths stay intact.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(root, p), "utf8");

// --- Feature: settings + API + pages ---
const members = read("src/lib/members.ts");
assert.match(members, /compCouponEnabled/);
assert.match(members, /compCouponDailyQuota/);
assert.match(members, /earn_comp_coupon/);
assert.match(members, /getCompCouponDailyUsage/);

const membersPage = read("src/app/members/page.tsx");
assert.match(membersPage, /QR ให้แต้ม/);
assert.match(membersPage, /โควต้า QR ให้แต้ม/);
assert.match(membersPage, /compCouponEnabled/);

const posMembers = read("functions/pos-members.js");
assert.match(posMembers, /issueCompCoupon/);
assert.match(posMembers, /claimCompCoupon/);
assert.match(posMembers, /buildPublicGiftUrl/);
assert.match(posMembers, /pointCoupons/);
assert.match(posMembers, /earn_comp_coupon/);
assert.match(posMembers, /meta\/compCouponDaily/);
assert.match(posMembers, /enabled: d\.enabled === true,/);
// Receipt claim signup path unchanged
assert.match(posMembers, /source: "receipt_qr"/);
assert.match(posMembers, /phone_otp_required/);
assert.match(posMembers, /async function claimReceiptPoints/);
assert.match(posMembers, /async function publicSignup/);
// Load module — catch syntax errors before Functions deploy.
const posMembersMod = require(join(root, "functions/pos-members.js"));
assert.equal(typeof posMembersMod.issueCompCoupon, "function");
assert.equal(typeof posMembersMod.claimCompCoupon, "function");

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /nposIssueCompCoupon/);
assert.match(nposSell, /publicCompCouponClaim/);
assert.match(nposSell, /membersCompCouponEnabled/);
assert.match(nposSell, /publicReceiptClaim/);
assert.match(nposSell, /publicMemberSignup/);
assert.match(nposSell, /publicMemberMe/);

const indexJs = read("functions/index.js");
assert.match(indexJs, /nposIssueCompCoupon/);
assert.match(indexJs, /publicCompCouponClaim/);
assert.match(indexJs, /publicReceiptClaim/);

const giftLib = read("src/lib/comp-coupon.ts");
assert.match(giftLib, /submitCompCouponClaim/);
assert.match(giftLib, /publicCompCouponClaim/);

const giftPage = read("src/app/gift/page.tsx");
assert.match(giftPage, /signInMemberWithGoogle/);
assert.match(giftPage, /sendPhoneOtp/);
sendPhoneOtpGuard(giftPage);
assert.match(giftPage, /sendLinkPhoneOtp/);
assert.match(giftPage, /รับแต้มจากร้าน/);
assert.match(giftPage, /completeMemberGoogleRedirect/);

const providers = read("src/components/AppRootProviders.tsx");
assert.match(providers, /isPublicGift/);
assert.match(providers, /isPublicClaim/);
assert.match(providers, /isPublicJoin/);
assert.match(providers, /isPublicMemberMe/);

// --- Customer signup surfaces still present ---
const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /signInMemberWithGoogle/);
assert.match(claimPage, /sendPhoneOtp/);
assert.match(claimPage, /sendLinkPhoneOtp/);
assert.match(claimPage, /submitReceiptClaim/);
assert.match(claimPage, /completeMemberGoogleRedirect/);
assert.match(claimPage, /phone_otp_required|ส่งรหัสยืนยันเบอร์/);

const mePage = read("src/app/me/page.tsx");
assert.match(mePage, /signInMemberWithGoogle/);
assert.match(mePage, /fetchMemberMe|เข้าด้วย Google/);
assert.match(mePage, /completeMemberGoogleRedirect/);

assert.ok(existsSync(join(root, "src/app/join/page.tsx")));
const joinPage = read("src/app/join/page.tsx");
assert.match(joinPage, /publicMemberSignup|token|สมัคร/);

const memberAuth = read("src/lib/member-auth.ts");
assert.match(memberAuth, /signInWithRedirect/);
assert.match(memberAuth, /completeMemberGoogleRedirect/);
assert.doesNotMatch(memberAuth, /startGoogleAuthBridge/);

const rules = read("firestore.rules");
assert.match(rules, /pointCoupons/);

// --- nPos button + slip ---
const sellXml = read("npos-telltea/app/src/main/res/layout/activity_sell.xml");
assert.match(sellXml, /giftCouponButton/);
assert.match(sellXml, /sell_hub_gift/);
// Pay bar order: สมาชิก → พิมพ์ให้แต้ม → บันทึก
const payBar = sellXml.slice(sellXml.indexOf('android:id="@+id/cartPayBar"'));
assert.match(payBar, /giftCouponButton/);
assert.ok(
  payBar.indexOf("memberButton") < payBar.indexOf("giftCouponButton") &&
    payBar.indexOf("giftCouponButton") < payBar.indexOf("holdBillButton"),
  "pay bar order: member → gift → hold",
);

const strings = read("npos-telltea/app/src/main/res/values/strings.xml");
assert.match(strings, /sell_hub_gift">พิมพ์ให้แต้ม</);

const sellAct = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sellAct, /showGiftCouponFlow/);
assert.match(sellAct, /buildGiftCouponLines/);
assert.match(sellAct, /membersCompCouponEnabled/);
assert.match(sellAct, /boolean showGift = on/);
assert.match(sellAct, /ชำระ \| สมาชิก \| พิมพ์ให้แต้ม \| บันทึก/);

const memberApi = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/MemberApi.java");
assert.match(memberApi, /nposIssueCompCoupon/);
assert.match(memberApi, /compCouponStatus/);

const formBuilder = read(
  "npos-telltea/app/src/main/java/app/telltea/npos/printer/ReceiptFormBuilder.java",
);
assert.match(formBuilder, /buildGiftCouponLines/);
assert.match(formBuilder, /ของขวัญแต้ม/);

const gradle = read("npos-telltea/app/build.gradle");
assert.match(gradle, /versionCode 152/);
const whats = read("npos-telltea/app/src/main/java/app/telltea/npos/update/WhatsNewCatalog.java");
assert.match(whats, /versionCode == 152/);

const appBuild = Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]);
assert.ok(appBuild >= 779, "APP_BUILD >= 779");

function sendPhoneOtpGuard(src) {
  assert.match(src, /sendPhoneOtp/);
}

console.log("OK test-members-comp-gift");
