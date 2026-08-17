/**
 * Guard: staff PIN login callables + client wiring (bypass Google/LINE).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const cf = read("functions/staff-pin-login.js");
assert.match(cf, /exports\.staffPinLogin/);
assert.match(cf, /exports\.setStaffLoginPin/);
assert.match(cf, /staffLoginSecrets/);
assert.match(cf, /staffNicknames/);
assert.match(cf, /createCustomToken/);
assert.match(cf, /scryptSync/);
assert.match(cf, /assertOwner/);
assert.match(cf, /normalizeNick|nickKey/);

assert.match(read("functions/index.js"), /staffPinLogin/);
assert.match(read("functions/index.js"), /setStaffLoginPin/);

assert.match(read("functions/resolve-my-staff.js"), /token\?\.staffId/);

const login = read("src/app/login/page.tsx");
assert.match(login, /signInWithStaffPin/);
assert.match(login, /LoginMode = "pin"/);
assert.match(login, /openInExternalBrowser/);
assert.match(login, /telltea-bo\.web\.app/);

assert.match(read("src/lib/staff-pin-login.ts"), /staffPinLogin/);
assert.match(read("src/lib/staff-pin-login.ts"), /setStaffLoginPin/);
assert.match(read("src/components/StaffReadinessEditModal.tsx"), /onSetLoginPin/);
assert.match(read("src/app/staff/page.tsx"), /setStaffLoginPin/);
assert.match(read("src/lib/version.ts"), /APP_BUILD = 817/);

const rules = read("firestore.rules");
assert.match(rules, /match \/staffLoginSecrets\/\{staffId\}/);
assert.match(rules, /match \/staffNicknames\/\{nickId\}/);
assert.match(rules, /match \/staffPinAttempts\/\{staffId\}/);

// Mirror CF nickKey + scrypt contract (no firebase-functions install needed)
function nickKey(raw) {
  return String(raw || "")
    .trim()
    .slice(0, 40)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_.-]/gu, "");
}
assert.equal(nickKey("  Namtoei 👸 "), "namtoei");
assert.equal(nickKey("เตย"), "เตย");

function hashPin(pin, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return crypto
    .scryptSync(String(pin), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
    .toString("hex");
}
const salt = crypto.randomBytes(16).toString("hex");
assert.equal(hashPin("1234", salt), hashPin("1234", salt));
assert.notEqual(hashPin("1234", salt), hashPin("9999", salt));

console.log("OK test-staff-pin-login");
