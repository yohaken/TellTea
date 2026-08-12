/**
 * Owner LINE alerts: instant condition + daily digest settings.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const version = read("src/lib/version.ts");
const settingsPage = read("src/app/settings/page.tsx");
const settingsLib = read("src/lib/settings.ts");
const ownerNotify = read("src/lib/owner-notify.ts");
const setup = read("src/components/OwnerNotifySetup.tsx");
const rules = read("firestore.rules");
const indexFn = read("functions/index.js");
const digestFn = read("functions/owner-daily-digest.js");
const lineOwner = read("functions/line-owner.js");
const more = read("src/app/more/page.tsx");

assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 786);

assert.match(settingsLib, /saveAlertSettings/);
assert.match(ownerNotify, /ownerLineNotify/);
assert.match(ownerNotify, /instantLineEnabled/);
assert.match(ownerNotify, /instantHourStart/);
assert.match(ownerNotify, /dailyDigestEnabled/);
assert.match(setup, /แจ้งทันทีเมื่อเข้าเงื่อนไข/);
assert.match(setup, /สรุปรายวัน → LINE/);
assert.match(setup, /ownerLineNotifyTest/);
assert.doesNotMatch(setup, /Web Push บนเครื่องนี้/);
assert.match(settingsPage, /OwnerNotifySetup/);
assert.match(more, /LINE สรุปเช้า/);

assert.match(rules, /ownerLineNotify/);
assert.match(indexFn, /sendLinePush/);
assert.match(indexFn, /hourInWindow/);
assert.match(indexFn, /instantLineEnabled/);
assert.match(digestFn, /flushDeferredLowBalanceLine/);
assert.match(lineOwner, /api\.line\.me\/v2\/bot\/message\/push/);
assert.match(digestFn, /billNotices/);
assert.equal(existsSync(join(root, "functions/line-owner.js")), true);

console.log("OK test-owner-line-daily-digest");
