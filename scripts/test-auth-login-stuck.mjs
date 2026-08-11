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

const login = read("src/app/login/page.tsx");
assert.match(login, /busyReason/);
assert.match(login, /AUTH_LOADING_ESCAPE_MS/);
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
