/**
 * Master sell phase plan + checklist wired into remaining docs.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-master-sell-phases.md")));
const plan = read("docs/npos-master-sell-phases.md");
assert.match(plan, /M1|M2|M3|M4|M5|M6|M7/);
assert.match(plan, /60–70%|60-70%/);
assert.match(plan, /ทานที่ร้าน|รับกลับ/);
assert.match(plan, /PromptPay|auto cut-off|ลิ้นชัก/);
assert.match(plan, /สลิปครัว|KDS/);
assert.match(plan, /Take Order|Review|Payment|Confirm|Print/i);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-master-sell-phases/);
assert.match(remaining, /\*\*M1\*\*|M1/);
assert.match(remaining, /ทานที่ร้าน \/ รับกลับ/);
assert.match(remaining, /สลิปครัว/);

console.log("OK test-npos-master-sell-phases");
