/**
 * Guard: resolveMyStaff callable + staffEmails index for phone-keyed Google logins.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const cf = read("functions/resolve-my-staff.js");
assert.match(cf, /exports\.resolveMyStaff/);
assert.match(cf, /staffEmails/);
assert.match(cf, /where\("email"/);
assert.match(cf, /migratePhoneKeyedToEmail|migratedFrom/);
assert.match(cf, /setCustomUserClaims/);
assert.match(cf, /claimUpdated/);

assert.match(read("functions/index.js"), /resolveMyStaff/);
assert.match(read("src/lib/staff.ts"), /getStaffByEmailIndex/);
assert.match(read("src/lib/staff.ts"), /syncStaffEmailIndex/);
assert.match(read("src/lib/auth.tsx"), /resolveStaffViaCallable|resolveMyStaff/);
assert.match(read("firestore.rules"), /match \/staffEmails\/\{emailId\}/);
assert.match(read("firestore.rules"), /claimStaffId/);

console.log("OK test-resolve-my-staff");
