/**
 * Guard: owner can soft-delete members with confirm dialog.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const members = read("src/lib/members.ts");
assert.match(members, /export type MemberStatus = "active" \| "suspended" \| "deleted"/);
assert.match(members, /export async function deleteMember/);
assert.match(members, /status !== "deleted"/);
assert.match(members, /prev\.status === "deleted"/);
assert.match(members, /สมาชิกถูกลบแล้ว/);

const page = read("src/app/members/page.tsx");
assert.match(page, /deleteMember/);
assert.match(page, /PosConfirmDialog/);
assert.match(page, /ลบสมาชิก/);
assert.match(page, /confirmDeleteOpen/);
assert.match(page, /confirmLabel="ยืนยัน"/);
assert.match(page, /destructive/);
assert.match(page, /canManage/);

const cf = read("functions/pos-members.js");
assert.match(cf, /function isMemberInactive/);
assert.match(cf, /status === "deleted"/);
assert.match(cf, /isMemberInactive\(m\)/);
assert.match(cf, /สมาชิกถูกลบแล้ว/);

const claim = read("src/lib/receipt-claim.ts");
assert.match(claim, /deleted:\s*"สมาชิกนี้ถูกลบแล้ว"/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 758);

console.log("OK test-members-owner-delete");
