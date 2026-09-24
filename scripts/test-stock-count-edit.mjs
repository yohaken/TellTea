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
assert.match(page, /onOpenFilled/);
assert.match(page, /onEdit=\{/);
assert.match(page, /แก้ไขยอด/);
assert.match(page, /บันทึกการแก้ไข/);
assert.match(page, /ไม่ต้องลบรอบ/);
assert.match(page, /buildCountDrafts/);
assert.match(page, /stockItemsForCount/);
assert.match(page, /includeInCount/);

const countLib = read("src/lib/stock-count.ts");
assert.match(countLib, /updatedBy: input\.createdBy/);
assert.match(countLib, /prev \? String\(prev\.createdBy/);
assert.match(countLib, /prev \? Number\(prev\.submittedAt\)/);
assert.match(countLib, /touchStaffPresenceFromActor/);

const rules = read("firestore.rules");
assert.match(rules, /signedIn\(\)/);
assert.match(rules, /match \/\{collection\}\/\{document=\*\*\}/);

const types = read("src/lib/types.ts");
assert.match(types, /updatedBy\?:/);
assert.match(types, /includeInCount/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD = (\d+)/)[1]) >= 1022);

console.log("OK test-stock-count-edit");
