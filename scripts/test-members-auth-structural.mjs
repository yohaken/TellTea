/**
 * Guard: member auth is TellTea-owned (no P-Note bridge hop).
 * Google = same-origin redirect; phone OTP hardened for Thai mobile.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const memberAuth = read("src/lib/member-auth.ts");
assert.match(memberAuth, /signInWithRedirect/);
assert.match(memberAuth, /getRedirectResult/);
assert.match(memberAuth, /completeMemberGoogleRedirect/);
assert.match(memberAuth, /export async function signInMemberWithGoogle/);
assert.match(memberAuth, /Member public auth/);

const phoneAuth = read("src/lib/phone-auth.ts");
assert.match(phoneAuth, /normalizeThaiMobileForOtp/);
assert.match(phoneAuth, /verifier\.render/);
assert.match(phoneAuth, /06 \/ 08 \/ 09/);

const claimLib = read("src/lib/receipt-claim.ts");
assert.match(claimLib, /export \{ signInMemberWithGoogle \}/);
assert.doesNotMatch(claimLib, /startGoogleAuthBridge/);
assert.doesNotMatch(claimLib, /shouldUseGoogleAuthBridge/);

const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /completeMemberGoogleRedirect/);
assert.match(claimPage, /from "@\/lib\/member-auth"/);
assert.match(claimPage, /ส่งรหัสไปเบอร์นี้/);
assert.doesNotMatch(claimPage, /completeGoogleAuthBridgeFromUrl/);

const mePage = read("src/app/me/page.tsx");
assert.match(mePage, /completeMemberGoogleRedirect/);
assert.match(mePage, /เข้าด้วยเบอร์/);
assert.doesNotMatch(mePage, /completeGoogleAuthBridgeFromUrl/);

const readme = read("README.md");
assert.match(readme, /src\/lib\/member-auth\.ts/);
assert.match(readme, /ไม่พึ่ง/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 755);

console.log("OK test-members-auth-structural");
