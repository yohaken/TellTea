/**
 * Guard: staff can get otEntries they can list — needed for backdated shift close.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const rules = read("firestore.rules");
const ot = read("src/lib/ot.ts");
const shiftClose = read("src/lib/shift-close.ts");
const receipts = read("src/lib/receipts.ts");
const otPage = read("src/app/ot/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD\s*=\s*547/);
assert.match(
  rules,
  /function canReadBonusEntry\(perm\) \{[\s\S]*?hasPerm\(perm\);/,
);
assert.doesNotMatch(
  rules,
  /function canReadBonusEntry\(perm\) \{[\s\S]*?in resource\.data\.workerIds/,
);
assert.match(ot, /knownCurrent\?: OtEntry/);
assert.match(shiftClose, /updateOtEntry\(entry\.id, fullPayload, entry\)/);
assert.match(otPage, /updateOtEntry\(entry\.id, payload, entry\)/);
assert.match(receipts, /ลงยอดย้อนหลังได้ถ้าเดือนยังไม่ปิดโบนัส/);

console.log("OK test-ot-backdate-permissions");
