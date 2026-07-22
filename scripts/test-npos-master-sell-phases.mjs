/**
 * Master sell scope: simple front-counter only (no dine-in split, no kitchen/KDS).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-master-sell-phases.md")));
const plan = read("docs/npos-master-sell-phases.md");
assert.match(plan, /หน้าร้าน|ขาเร็ว/);
assert.match(plan, /ไม่แยก|ไม่ทำ/);
assert.match(plan, /ทานที่ร้าน|รับกลับ/);
assert.match(plan, /สลิปครัว|KDS/);
assert.match(plan, /ใบเสร็จ/);
assert.match(plan, /S1|S2|S3/);
assert.doesNotMatch(plan, /### M6 — Print/);
assert.doesNotMatch(plan, /สลับ \*\*ทานที่ร้าน/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-master-sell-phases/);
assert.match(remaining, /นอกสcope|ไม่ทำ/);
assert.match(remaining, /สลิปครัว|KDS/);
assert.match(remaining, /\*\*S1\*\*|S1/);
assert.match(remaining, /1\.14\.1|สองพาเนล|auto-resize/);
assert.match(remaining, /Local DB first|local-first|โคลนผัง/);

console.log("OK test-npos-master-sell-phases");
