/**
 * Guard: staff login must not spin forever on bridge/staff Firestore hangs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const auth = read("src/lib/auth.tsx");
assert.match(auth, /AUTH_BRIDGE_TIMEOUT_MS/);
assert.match(auth, /AUTH_STAFF_RESOLVE_TIMEOUT_MS/);
assert.match(auth, /AUTH_LOADING_ESCAPE_MS/);
assert.match(auth, /AuthBusyReason/);
assert.match(auth, /busyReason/);
assert.match(auth, /withTimeout/);
assert.match(auth, /setBusyReason\("bridge"\)/);
assert.match(auth, /setBusyReason\("staff"\)/);
assert.match(auth, /ตรวจสิทธิ์หมดเวลา/);
assert.match(auth, /อ่านตั๋วล็อกอินหมดเวลา/);
assert.match(auth, /getDocFromServer/);
assert.match(auth, /LOGIN_TICKET_SESSION_KEY|telltea_login_ticket/);
assert.match(auth, /bridgeExchangeInFlight|exchangeBridgeTicketIfPresent/);
assert.match(auth, /exchangeLoginTicket/);
assert.match(auth, /signInWithRedirect/);
assert.match(auth, /completeStaffGoogleRedirect|getRedirectResult/);
assert.match(auth, /shouldPreferStaffGooglePopup/);
assert.match(auth, /NEXT_PUBLIC_FORCE_AUTH_BRIDGE/);
// Default path must not send staff to cross-domain bridge
assert.match(auth, /shouldUseGoogleAuthBridge[\s\S]{0,200}return false/);
const cf = read("functions/auth-login-ticket.js");
assert.match(cf, /exchangeLoginTicket/);
assert.match(cf, /loginTickets/);
assert.match(read("functions/index.js"), /exchangeLoginTicket/);

assert.match(auth, /getStaffByPhone\(user\.phoneNumber\)/);
assert.match(read("src/lib/staff.ts"), /phoneDocId\(phone\)/);
assert.match(auth, /getStaffByEmailIndex/);
assert.match(auth, /resolveMyStaff/);
assert.match(auth, /getIdToken\(true\)/);
assert.match(auth, /resolveStaffLocal/);
assert.match(auth, /AUTH_STAFF_CALLABLE_TIMEOUT_MS/);
assert.match(auth, /ownerFallbackMember|isAppOwnerEmail/);
assert.match(auth, /void resolveStaffViaCallable/);
assert.match(auth, /signInWithPopup/);
assert.match(auth, /auth\.currentUser/);
assert.match(auth, /missing initial state|storage-partitioned/);

const firebase = read("src/lib/firebase.ts");
assert.match(firebase, /resolveAuthDomain/);
assert.match(firebase, /telltea-bo\.web\.app/);
assert.match(firebase, /authDomain: resolveAuthDomain\(\)/);

const login = read("src/app/login/page.tsx");
assert.match(login, /busyReason/);
assert.match(login, /AUTH_LOADING_ESCAPE_MS/);
assert.match(login, /staffHomeHref\(staff\)/);
assert.match(login, /กำลังเข้าสู่ระบบ\.\.\./);
assert.match(login, /ล็อกอินค้างนานผิดปกติ/);
assert.doesNotMatch(login, /กำลังเตรียมระบบ/);
// Cold boot must not claim Google verification
assert.doesNotMatch(
  login,
  /status === "loading"[\s\S]{0,80}กำลังยืนยันสิทธิ์จาก Google/,
);

const gate = read("src/components/AuthGate.tsx");
assert.match(gate, /AUTH_LOADING_ESCAPE_MS/);
assert.match(gate, /ค้างนานผิดปกติ/);
assert.match(gate, /busyReason/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 764);

console.log("OK test-auth-login-stuck");
