/**
 * Guard: staff can edit filled stock count rounds without delete/recreate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const page = read("src/app/stock/page.tsx");
assert.match(page, /onEditFilled/);
assert.match(page, /แก้ไขยอด/);
assert.match(page, /บันทึกการแก้ไข/);
assert.match(page, /ไม่ต้องลบรอบ/);
assert.match(page, /buildCountDrafts/);

const countLib = read("src/lib/stock-count.ts");
assert.match(countLib, /updatedBy: input\.createdBy/);
assert.match(countLib, /prev \? String\(prev\.createdBy/);
assert.match(countLib, /prev \? Number\(prev\.submittedAt\)/);

const rules = read("firestore.rules");
assert.match(rules, /match \/stockCountSessions\/\{sessionId\}/);
assert.match(rules, /request\.resource\.data\.updatedBy == actorId\(\)/);
assert.match(
  rules,
  /request\.resource\.data\.createdBy == resource\.data\.createdBy/,
);

const types = read("src/lib/types.ts");
assert.match(types, /updatedBy\?:/);

const version = read("src/lib/version.ts");
assert.match(version, /APP_BUILD = 678/);

console.log("OK test-stock-count-edit");
