/**
 * Nickname update must write roster before pay, and verify read-back.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const emp = read("src/lib/employees.ts");
const staffPage = read("src/app/staff/page.tsx");
const presence = read("src/lib/staff-presence.ts");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 528/);
assert.match(emp, /เขียน roster ก่อนเสมอ/);
assert.match(emp, /ยืนยันชื่อเล่นถูกเขียนจริง/);
assert.match(emp, /บันทึกชื่อเล่นไม่สำเร็จ/);
// roster updateDoc must appear before setEmployeePay in source order
const rosterWrite = emp.indexOf("if (hasRosterPatch)");
const payWrite = emp.indexOf("if (hasPayPatch)");
assert.ok(rosterWrite > 0 && payWrite > rosterWrite, "roster write before pay write");
assert.match(staffPage, /onPatchLocal/);
assert.match(presence, /findEmployeeForPresence/);
assert.match(presence, /nickname: data\.nickname \? String\(data\.nickname\)/);

console.log("test-nickname-update: ok");
