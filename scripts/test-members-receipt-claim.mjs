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
assert.match(claimPage, /เข้าด้วย Google/);
assert.match(claimPage, /ใช้เบอร์แทน/);
assert.match(claimPage, /สะสมแต้มจากบิลนี้/);
assert.match(claimPage, /มูลค่าส่วนลด/);
assert.match(claimPage, /รับแต้มเลย/);
assert.match(claimPage, /เย้ ได้แต้มแล้ว|สมัครแล้ว ได้แต้มเลย/);
assert.match(claimPage, /ลดได้ถึง/);
assert.match(claimPage, /claim-success-popup|claim-success-overlay/);
assert.match(claimPage, /sendPhoneOtp/);
assert.match(claimPage, /sendLinkPhoneOtp/);
assert.match(claimPage, /ส่งรหัสยืนยันเบอร์/);
assert.match(claimPage, /ได้แต้มจากบิลนี้ไปแล้ว/);
assert.match(claimPage, /ดูแต้มของฉัน/);
assert.match(claimPage, /"used"/);
assert.match(claimPage, /ClaimPointsValueNote/);
const valueNote = read("src/components/ClaimPointsValueNote.tsx");
assert.match(valueNote, /1 แต้ม = ส่วนลด 1 บาท/);
assert.match(valueNote, /claim-value-note-steps/);
assert.match(valueNote, /สแกน QR รับแต้มจากบิล/);
assert.match(valueNote, /ครั้งหน้าบอกเบอร์ตอนจ่าย/);
assert.match(valueNote, /ไม่ต้องรอครบแก้ว/);
const mePageSrc = read("src/app/me/page.tsx");
assert.match(mePageSrc, /ClaimPointsValueNote/);
assert.doesNotMatch(claimPage, /ดำเนินการต่อด้วย Google/);
assert.doesNotMatch(claimPage, /นโยบายข้อมูลส่วนบุคคล/);

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
assert.match(mePage, /แต้มของฉัน/);
assert.match(mePage, /ส่งรหัส|รหัส 6 หลัก/);

const providers = read("src/components/AppRootProviders.tsx");
assert.match(providers, /isPublicClaim/);
assert.match(providers, /isPublicMemberMe/);

const posMembers = read("functions/pos-members.js");
assert.match(posMembers, /lookupReceiptClaimAuth/);
assert.match(posMembers, /getMyMember/);
assert.match(posMembers, /googleUid/);
assert.match(posMembers, /phone_otp_required/);
assert.match(posMembers, /phone_mismatch/);
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
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 760);
assert.match(claimLib, /ลองใหม่อีกครั้งนะ/);
assert.match(claimLib, /ได้แต้มจากบิลนี้ไปแล้ว/);

assert.equal(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/MemberApi.java")),
  true,
);
const gradle = read("npos-telltea/app/build.gradle");
assert.ok(Number(gradle.match(/versionCode\s+(\d+)/)[1]) >= 141);

console.log("OK test-members-receipt-claim");
