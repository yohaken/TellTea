/**
 * Gate: sell-flow polish checklist (F0–F5) — dine-in cut + extracted work.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-sell-flow-polish-checklist.md")));
const doc = read("docs/npos-sell-flow-polish-checklist.md");

assert.match(doc, /F0|ตัด.*ทานที่ร้าน/);
assert.match(doc, /ล้างตะกร้า/);
assert.match(doc, /PromptPay/);
assert.match(doc, /Delivery|รับกลับ/);
assert.match(doc, /ไม่ทำ|ตัดออก/);
assert.match(doc, /F1|F2|F3|F4|F5/);
assert.doesNotMatch(doc, /ต้องทำ.*ทานที่ร้าน\/รับกลับ\/Delivery/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-sell-flow-polish-checklist/);
assert.match(remaining, /F0–F5/);

console.log("OK test-npos-sell-flow-polish");
