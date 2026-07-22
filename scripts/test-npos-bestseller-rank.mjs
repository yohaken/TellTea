/**
 * Gate: bestseller rank checklist locked decisions (R0).
 * Implementation phases R1–R5 come later.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.ok(existsSync(join(root, "docs/npos-bestseller-rank-checklist.md")));
const doc = read("docs/npos-bestseller-rank-checklist.md");

assert.match(doc, /fix/);
assert.match(doc, /bestsellers/);
assert.match(doc, /7\s*วัน/);
assert.match(doc, /14\s*วัน/);
assert.match(doc, /Local-first|local-first/i);
assert.match(doc, /ไม่เลื่อนทุกบิล|ไม่เลื่อนกลาง/);
assert.match(doc, /ขายดีของจริง|ข้อมูลจริง/);
assert.match(doc, /R1|R2|R3|R4|R5/);

const remaining = read("docs/npos-remaining-checklist.md");
assert.match(remaining, /npos-bestseller-rank-checklist/);
assert.match(remaining, /R0–R5|bestsellers|ขายดี/);

console.log("OK test-npos-bestseller-rank");
