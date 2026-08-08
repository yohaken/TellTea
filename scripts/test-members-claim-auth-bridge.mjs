/**
 * Guard: /claim + /me Google uses firebaseapp auth bridge (not raw popup on prod),
 * and never surfaces Firebase auth/argument-error as “สมัครไม่ได้”.
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
assert.match(auth, /Firebase:.*Error/);

const claimLib = read("src/lib/receipt-claim.ts");
assert.match(claimLib, /shouldUseGoogleAuthBridge/);
assert.match(claimLib, /startGoogleAuthBridge/);
assert.match(claimLib, /claimBlockedTitle/);
assert.match(claimLib, /Promise<User \| null>/);

const claimPage = read("src/app/claim/page.tsx");
assert.match(claimPage, /completeGoogleAuthBridgeFromUrl/);
assert.match(claimPage, /mapFirebaseAuthError/);
assert.match(claimPage, /claimBlockedTitle/);
assert.match(claimPage, /ดูแต้มของฉัน/);
assert.doesNotMatch(claimPage, /err\.message : "เข้า Google/);

const mePage = read("src/app/me/page.tsx");
assert.match(mePage, /completeGoogleAuthBridgeFromUrl/);
assert.match(mePage, /mapFirebaseAuthError/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 754);

console.log("OK test-members-claim-auth-bridge");
