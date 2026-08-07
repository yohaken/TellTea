/**
 * Guard: members CRM M0–M4 wired without forcing live counter path.
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
assert.match(members, /enabled: false/);
assert.match(members, /void_reverse/);

const page = read("src/app/members/page.tsx");
assert.match(page, /canAccessMembersHub/);
assert.match(page, /สมัครสมาชิก/);
assert.match(page, /ปรับแต้ม/);

const joinPage = read("src/app/join/page.tsx");
assert.match(joinPage, /publicMemberSignup/);
assert.match(joinPage, /TellTea/);

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
assert.match(indexes, /"saleId"/);

const sale = read("functions/pos-complete-sale.js");
assert.match(sale, /memberId/);
assert.match(sale, /tryEarnPointsForSale/);
assert.match(sale, /pointsToRedeem/);
assert.match(sale, /tryReverseEarnForVoid/);
// Must not require member on every sale
assert.match(sale, /Optional CRM/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /nposMemberLookup/);
assert.match(nposSell, /nposMemberQuickCreate/);
assert.match(nposSell, /publicMemberSignup/);
assert.match(nposSell, /membersEnabled/);

const posMembers = read("functions/pos-members.js");
assert.match(posMembers, /enabled: d\.enabled === true/);
assert.match(posMembers, /tryEarnPointsForSale/);

const idx = read("functions/index.js");
assert.match(idx, /nposMemberLookup/);
assert.match(idx, /publicMemberSignup/);

const sellJava = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.match(sellJava, /showMemberDialog/);
assert.match(sellJava, /membersEnabled/);
assert.match(sellJava, /pointsToRedeem/);

const saleSync = read("npos-telltea/app/src/main/java/app/telltea/npos/sell/SaleSync.java");
assert.match(saleSync, /memberId/);
assert.match(saleSync, /pointsToRedeem/);

const gradle = read("npos-telltea/app/build.gradle");
assert.match(gradle, /versionCode 138/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 724);
const posVersion = read("src/lib/pos-version.ts");
assert.ok(Number(posVersion.match(/POS_BUILD = (\d+)/)[1]) >= 186);

const phases = read("docs/members-crm-phases.md");
assert.match(phases, /M0/);
assert.match(phases, /M2/);
assert.match(phases, /M4/);
assert.match(phases, /ค่าเริ่มต้นระบบสมาชิก = ปิด/);

console.log("OK test-members-crm-m0");
