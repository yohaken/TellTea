/**
 * Staff email/password login — password defaults to Thai mobile 10 digits.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

function passwordFromPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  else if (!digits.startsWith("0") && digits.length === 9) digits = `0${digits}`;
  return /^0[689]\d{8}$/.test(digits) ? digits : null;
}

const login = read("src/app/login/page.tsx");
assert.match(login, /signInWithStaffEmailPassword|LoginMode = "email"/);
assert.match(login, /รหัสผ่าน \(เบอร์โทร 10 หลัก\)/);
assert.match(login, /เข้าสู่ระบบด้วย Google/);
assert.doesNotMatch(login, /signInWithStaffPin|เข้าใช้ด้วย PIN|ชื่อ \+ PIN/);

assert.match(read("src/lib/auth.tsx"), /signInWithStaffEmailPassword/);
assert.ok(existsSync(join(root, "src/lib/staff-email-login.ts")));
assert.ok(existsSync(join(root, "scripts/batch-set-staff-email-password.mjs")));

assert.equal(passwordFromPhone("+66985081617"), "0985081617");
assert.equal(passwordFromPhone("0985081617"), "0985081617");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 844);

console.log("OK test-staff-email-login");
