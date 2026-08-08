/**
 * Guard: staff BO still has firebaseapp bridge helpers;
 * member claim/me moved to TellTea-owned redirect (see test-members-auth-structural).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const auth = read("src/lib/auth.tsx");
assert.match(auth, /export function mapFirebaseAuthError/);
assert.match(auth, /auth\/argument-error/);
assert.match(auth, /export function startGoogleAuthBridge/);
assert.match(auth, /export async function completeGoogleAuthBridgeFromUrl/);
assert.match(auth, /TELLTEA_AUTH_BRIDGE|telltea-auth\.html/);

const claimLib = read("src/lib/receipt-claim.ts");
assert.match(claimLib, /claimBlockedTitle/);
assert.match(claimLib, /signInMemberWithGoogle/);
assert.doesNotMatch(claimLib, /startGoogleAuthBridge/);

const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /completeMemberGoogleRedirect|mapFirebaseAuthError/);
assert.match(claimPage, /claimBlockedTitle/);
assert.match(claimPage, /ดูแต้มของฉัน/);
assert.doesNotMatch(claimPage, /err\.message : "เข้า Google/);

const mePage = read("src/app/me/page.tsx");
assert.match(mePage, /completeMemberGoogleRedirect|mapFirebaseAuthError/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 755);

console.log("OK test-members-claim-auth-bridge");
