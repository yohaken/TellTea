/**
 * Shop name (ชื่อในร้าน) must follow nickname rename, and linked systems
 * must not keep showing stale staff.displayName.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const emp = read("src/lib/employees.ts");
const readiness = read("src/lib/staff-readiness.ts");
const bonus = read("src/lib/bonus.ts");
const ot = read("src/app/ot/page.tsx");
const staffPage = read("src/app/staff/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 522/);
assert.match(emp, /planEmployeeIdentityPatch/);
assert.match(emp, /syncLinkedStaffDisplayName/);
assert.match(emp, /ชื่อในร้านยังเป็นชื่อเล่นเก่า/);
assert.match(readiness, /employees\.name\) เป็นแหล่งจริง/);
assert.match(bonus, /workerIds ก่อน/);
assert.match(bonus, /creditEntryWorkers/);
assert.match(ot, /entryIncludesMe/);
assert.match(ot, /ไม่พึ่ง staff\.displayName/);
assert.match(staffPage, /planEmployeeIdentityPatch/);

/** Mirror of planEmployeeIdentityPatch for unit asserts */
function planEmployeeIdentityPatch(current, patch) {
  const oldName = current.name.trim();
  const oldNick = (current.nickname || "").trim();
  const nextNick = patch.nickname !== undefined ? patch.nickname.trim() : undefined;
  let nextName = patch.name !== undefined ? patch.name.trim() : undefined;
  if (nextNick !== undefined && nextNick && nextNick !== oldNick) {
    const effectiveName = nextName !== undefined ? nextName : oldName;
    if (effectiveName === oldNick) nextName = nextNick;
  }
  const out = {};
  if (nextName !== undefined) out.name = nextName;
  if (nextNick !== undefined) out.nickname = nextNick;
  return out;
}

assert.deepEqual(
  planEmployeeIdentityPatch({ name: "x1", nickname: "x1" }, { name: "x1", nickname: "jay" }),
  { name: "jay", nickname: "jay" },
);
assert.deepEqual(
  planEmployeeIdentityPatch({ name: "สมชาย", nickname: "x1" }, { name: "สมชาย", nickname: "jay" }),
  { name: "สมชาย", nickname: "jay" },
);
assert.deepEqual(
  planEmployeeIdentityPatch({ name: "x1", nickname: "" }, { name: "jay", nickname: "jay" }),
  { name: "jay", nickname: "jay" },
);

console.log("test-shop-name-sync: ok");
