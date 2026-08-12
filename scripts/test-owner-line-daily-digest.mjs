/**
 * Owner LINE morning digest + settings hub wiring.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const settingsPage = read("src/app/settings/page.tsx");
const alerts = read("src/app/alerts/page.tsx");
const settingsLib = read("src/lib/settings.ts");
const ownerNotify = read("src/lib/owner-notify.ts");
const setup = read("src/components/OwnerNotifySetup.tsx");
const rules = read("firestore.rules");
const indexFn = read("functions/index.js");
const digestFn = read("functions/owner-daily-digest.js");
const more = read("src/app/more/page.tsx");

assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 785);

assert.match(settingsLib, /saveAlertSettings/);
assert.match(ownerNotify, /ownerLineNotify/);
assert.match(ownerNotify, /dailyDigestEnabled/);
assert.match(setup, /OwnerNotifySetup/);
assert.match(setup, /ownerLineNotifyTest/);
assert.match(setup, /Channel access token/);
assert.match(settingsPage, /OwnerNotifySetup/);
assert.match(alerts, /router\.replace\("\/settings\/"\)/);
assert.match(more, /LINE สรุปเช้า/);

assert.match(rules, /ownerLineNotify/);
assert.match(rules, /ownerDailyDigestState/);
assert.match(indexFn, /ownerDailyDigestHourly/);
assert.match(indexFn, /ownerLineNotifyTest/);
assert.match(digestFn, /api\.line\.me\/v2\/bot\/message\/push/);
assert.match(digestFn, /billNotices/);
assert.match(digestFn, /posSales/);
assert.match(digestFn, /digestHour/);
assert.match(digestFn, /clampHour/);
assert.match(digestFn, /return 8/);
assert.match(digestFn, /5 \* \* \* \*/);
assert.equal(existsSync(join(root, "functions/owner-daily-digest.js")), true);

console.log("OK test-owner-line-daily-digest");
