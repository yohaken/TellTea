/**
 * Server-backed staff lastSeenAt (callable + OT/prod/stock triggers).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(Number(read("src/lib/version.ts").match(/APP_BUILD\s*=\s*(\d+)/)[1]) >= 686);

const fn = read("functions/staff-presence.js");
assert.match(fn, /exports\.touchStaffPresence/);
assert.match(fn, /onOtEntryCreatedForPresence/);
assert.match(fn, /onProdEntryCreatedForPresence/);
assert.match(fn, /onStockCountWrittenForPresence/);
assert.match(fn, /resolveCallerStaffId/);
assert.match(fn, /bumpLastSeen/);
assert.match(fn, /createdAt only/);

const index = read("functions/index.js");
assert.match(index, /staff-presence/);
assert.match(index, /exports\.touchStaffPresence/);
assert.match(index, /onOtEntryCreatedForPresence/);

const client = read("src/lib/staff-presence.ts");
assert.match(client, /touchStaffPresenceViaCallable/);
assert.match(client, /httpsCallable/);
assert.match(client, /"touchStaffPresence"/);

const rules = read("firestore.rules");
assert.match(rules, /isOwnStaffDoc\(staffId\) \|\| staffHubManage\(\)/);

const dump = read("scripts/dump-staff-presence.mjs");
assert.match(dump, /presence vs ot-create mismatches/);
assert.match(dump, /ot create/);
assert.doesNotMatch(dump, /ot update \$\{/);

console.log("test-staff-presence-server: ok");
