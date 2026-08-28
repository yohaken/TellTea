/**
 * Staff PIN login UI + batch phone PIN helpers.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

function pinFromPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  else if (!digits.startsWith("0") && digits.length === 9) digits = `0${digits}`;
  const pin = digits.slice(-6);
  return /^\d{4,6}$/.test(pin) ? pin : null;
}

const login = read("src/app/login/page.tsx");
assert.match(login, /signInWithStaffPin|LoginMode = "pin"|เข้าใช้ด้วย PIN/);
assert.match(login, /ชื่อ \+ PIN/);
assert.match(login, /เข้าสู่ระบบด้วย Google/);

assert.match(read("src/lib/auth.tsx"), /signInWithStaffPin/);
assert.ok(existsSync(join(root, "src/lib/staff-pin-login.ts")));
assert.ok(existsSync(join(root, "scripts/batch-set-staff-pin-from-phone.mjs")));

assert.equal(pinFromPhone("+66985081617"), "081617");
assert.equal(pinFromPhone("0985081617"), "081617");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 843);

console.log("OK test-staff-pin-login");
