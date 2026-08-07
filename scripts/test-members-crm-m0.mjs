/**
 * Guard: members CRM M0/M1 skeleton (BOH) is wired.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const perms = read("src/lib/permissions.ts");
assert.match(perms, /membersView/);
assert.match(perms, /membersManage/);
assert.match(perms, /membersAdjustPoints/);
assert.match(perms, /canAccessMembersHub/);

const members = read("src/lib/members.ts");
assert.match(members, /MEMBERS_COLLECTION/);
assert.match(members, /memberLedger/);
assert.match(members, /adjustMemberPoints/);
assert.match(members, /qr_self/);
assert.match(members, /publicSignupEnabled/);
assert.match(members, /pointsFromSaleAmount/);

const page = read("src/app/members/page.tsx");
assert.match(page, /canAccessMembersHub/);
assert.match(page, /สมัครสมาชิก/);
assert.match(page, /ปรับแต้ม/);

const more = read("src/app/more/page.tsx");
assert.match(more, /\/members\//);
assert.match(more, /สมาชิก \/ แต้ม/);

const shell = read("src/components/AppShell.tsx");
assert.match(shell, /"\/members"/);

const rules = read("firestore.rules");
assert.match(rules, /match \/members\/\{memberId\}/);
assert.match(rules, /match \/memberLedger\/\{entryId\}/);
assert.match(rules, /membersHubManage/);
assert.match(rules, /memberSettings/);

const indexes = read("firestore.indexes.json");
assert.match(indexes, /memberLedger/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 723);
const posVersion = read("src/lib/pos-version.ts");
assert.ok(Number(posVersion.match(/POS_BUILD = (\d+)/)[1]) >= 185);

const phases = read("docs/members-crm-phases.md");
assert.match(phases, /M0/);
assert.match(phases, /M1/);
assert.match(phases, /M2/);
assert.match(phases, /M4/);

console.log("OK test-members-crm-m0");
