/**
 * Guard: receipt QR claim — Google-first auth, secure /me view.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const members = read("src/lib/members.ts");
assert.match(members, /receiptClaimEnabled: false/);
assert.match(members, /pointsFromReceiptClaim/);

const claimLib = read("src/lib/receipt-claim.ts");
assert.match(claimLib, /signInMemberWithGoogle/);
assert.match(claimLib, /submitReceiptClaim/);
assert.match(claimLib, /fetchMemberMe/);
assert.match(claimLib, /publicMemberMe/);
assert.match(claimLib, /claimed && !opts\?\.forceNewToken/);
assert.match(claimLib, /โทเคนใหม่ \(เทส\)/);
assert.doesNotMatch(claimLib, /confirmExisting/);

const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /signInMemberWithGoogle|onGoogle/);
assert.match(claimPage, /ดำเนินการต่อด้วย Google/);
assert.match(claimPage, /ใช้เบอร์โทรแทน/);
assert.match(claimPage, /claim-success-popup|claim-success-overlay/);
assert.match(claimPage, /sendPhoneOtp/);
assert.match(claimPage, /แต้มบิลนี้ใช้แล้ว/);
assert.match(claimPage, /ดูแต้มของฉัน/);
assert.match(claimPage, /"used"/);

const membersPage = read("src/app/members/page.tsx");
assert.match(membersPage, /แสดง QR/);
assert.match(membersPage, /โทเคนใหม่ \(เทส\)/);
assert.match(membersPage, /QR เดิม/);
assert.match(membersPage, /members-claim-qr-panel|claimQrPanelRef/);
assert.match(membersPage, /scrollIntoView/);
assert.match(membersPage, /members-claim-row-btn/);
assert.doesNotMatch(
  membersPage,
  /disabled=\{!canManage \|\| saving \|\| s\.claimStatus === "claimed"\}/,
);

const mePage = read("src/app/me/page.tsx");
assert.match(mePage, /fetchMemberMe/);
assert.match(mePage, /เข้าด้วย Google/);
assert.match(mePage, /OTP/);

const providers = read("src/components/AppRootProviders.tsx");
assert.match(providers, /isPublicClaim/);
assert.match(providers, /isPublicMemberMe/);

const posMembers = read("functions/pos-members.js");
assert.match(posMembers, /lookupReceiptClaimAuth/);
assert.match(posMembers, /getMyMember/);
assert.match(posMembers, /googleUid/);
assert.match(posMembers, /phone_required/);
assert.doesNotMatch(posMembers, /confirmExisting === true/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /publicReceiptClaimLookup/);
assert.match(nposSell, /publicReceiptClaim/);
assert.match(nposSell, /publicMemberMe/);

const index = read("functions/index.js");
assert.match(index, /publicMemberMe/);

const smoke = read("scripts/smoke-hosting-export.mjs");
assert.match(smoke, /"claim"/);
assert.match(smoke, /"me"/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 735);

assert.equal(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/MemberApi.java")),
  false,
);
const gradle = read("npos-telltea/app/build.gradle");
assert.match(gradle, /versionCode 137/);

console.log("OK test-members-receipt-claim");
