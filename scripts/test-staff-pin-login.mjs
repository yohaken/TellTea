/**
 * PIN callables may remain deployed but UI must not surface PIN login.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const login = read("src/app/login/page.tsx");
assert.doesNotMatch(login, /signInWithStaffPin|LoginMode = "pin"|เข้าใช้ด้วย PIN/);
assert.match(login, /เข้าสู่ระบบด้วย Google/);
assert.match(login, /เบอร์โทร/);

assert.doesNotMatch(read("src/app/staff/page.tsx"), /setStaffLoginPin/);
assert.doesNotMatch(read("src/components/StaffReadinessEditModal.tsx"), /onSetLoginPin/);
assert.equal(existsSync(join(root, "src/lib/staff-pin-login.ts")), false);
assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD = (\d+)/)[1]) >= 818);

console.log("OK test-staff-pin-login (UI reverted)");
