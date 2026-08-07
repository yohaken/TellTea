/**
 * Guard: first-time claim after Google requires phone OTP (link + server).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const phoneAuth = read("src/lib/phone-auth.ts");
assert.match(phoneAuth, /linkWithPhoneNumber/);
assert.match(phoneAuth, /sendLinkPhoneOtp/);
assert.match(phoneAuth, /currentAuthHasVerifiedPhone/);

const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /sendLinkPhoneOtp/);
assert.match(claimPage, /otpPurpose/);
assert.match(claimPage, /link_claim/);
assert.match(claimPage, /ส่ง OTP ยืนยันเบอร์/);
assert.match(claimPage, /ยืนยัน OTP แล้วสมัคร/);
assert.doesNotMatch(claimPage, /onLinkAndClaim/);

const claimLib = read("src/lib/receipt-claim.ts");
assert.match(claimLib, /phone_otp_required/);
assert.match(claimLib, /phone_mismatch/);

const server = read("functions/pos-members.js");
assert.match(server, /phone_otp_required/);
assert.match(server, /phoneDigitsFromInput\(phoneFromAuth\)/);
assert.match(server, /phone_mismatch/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 747);

console.log("OK test-members-claim-google-phone-otp");
