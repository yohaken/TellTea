/**
 * Guard: members CRM — BOH first. nPos counter UI is deferred (must not pin APK).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const perms = read("src/lib/permissions.ts");
assert.match(perms, /membersView/);
assert.match(perms, /membersManage/);
assert.match(perms, /membersAdjustPoints/);
assert.match(perms, /canAccessMembersHub/);
assert.match(perms, /OWNER_ONLY_PERMISSION_KEYS/);
assert.match(perms, /member\?\.role === "owner"/);

const members = read("src/lib/members.ts");
assert.match(members, /MEMBERS_COLLECTION/);
assert.match(members, /memberLedger/);
assert.match(members, /adjustMemberPoints/);
assert.match(members, /enabled: false/);

const page = read("src/app/members/page.tsx");
assert.match(page, /canAccessMembersHub/);
assert.match(page, /สมัคร/);
assert.match(page, /members-slim-table--list/);
assert.match(page, /members-col-name/);
assert.match(page, /members-col-phone/);
assert.match(page, /members-col-card/);

const css = read("src/app/globals.css");
assert.match(css, /members-slim-table--list/);
assert.match(css, /table-layout:\s*fixed/);

const joinPage = read("src/app/join/page.tsx");
assert.match(joinPage, /publicMemberSignup/);

const more = read("src/app/more/page.tsx");
assert.match(more, /\/members\//);

const shell = read("src/components/AppShell.tsx");
assert.match(shell, /"\/members"/);

const rules = read("firestore.rules");
assert.match(rules, /match \/members\/\{memberId\}/);
assert.match(rules, /membersHubManage/);
assert.match(rules, /function membersHubView\(\) \{\s*return isOwner\(\) \|\| isOwnerEmail\(\);/s);

const sale = read("functions/pos-complete-sale.js");
assert.match(sale, /Optional CRM/);
assert.match(sale, /tryEarnPointsForSale/);

const nposSell = read("functions/npos-sell.js");
assert.match(nposSell, /membersEnabled/);
assert.match(nposSell, /publicMemberSignup/);

// Phase-1: no nPos counter CRM UI / no APK bump for members
assert.equal(
  existsSync(join(root, "npos-telltea/app/src/main/java/app/telltea/npos/sell/MemberApi.java")),
  false,
  "MemberApi.java must not ship in BOH-first phase",
);
const sellJava = read("npos-telltea/app/src/main/java/app/telltea/npos/SellActivity.java");
assert.doesNotMatch(sellJava, /showMemberDialog/);
assert.doesNotMatch(sellJava, /membersEnabled/);
const gradle = read("npos-telltea/app/build.gradle");
assert.match(gradle, /versionCode 137/);
const apkRelease = read("src/lib/npos-apk-release.ts");
assert.match(apkRelease, /NPOS_SYSTEM_VERSION_CODE = 137/);

const picker = read("src/components/PermissionPicker.tsx");
assert.match(picker, /OWNER_ONLY_PERMISSION_KEYS/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 737);

const phases = read("docs/members-crm-phases.md");
assert.match(phases, /หลังร้าน/);
assert.match(phases, /เจ้าของ/);

console.log("OK test-members-crm-m0");
