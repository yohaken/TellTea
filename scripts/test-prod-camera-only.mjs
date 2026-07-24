/**
 * Production + OT: camera-only live capture (no gallery) to reduce bonus fraud.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const prod = read("src/app/production/page.tsx");
const ot = read("src/app/ot/page.tsx");
const multi = read("src/components/PhotoAttachMultiField.tsx");
const version = read("src/lib/version.ts");

assert.match(prod, /allowGallery=\{false\}/);
assert.match(prod, /requireLiveCapture/);
assert.match(prod, /ถ่ายสดจากกล้องเท่านั้น/);
assert.match(ot, /allowGallery=\{false\}/);
assert.match(ot, /requireLiveCapture/);
assert.match(ot, /ถ่ายสดเท่านั้น/);
assert.match(multi, /allowGallery/);
assert.match(multi, /requireLiveCapture/);
assert.match(multi, /ต้องถ่ายสดจากกล้อง/);
assert.match(multi, /capture="environment"/);
assert.match(version, /APP_BUILD\s*=\s*273/);

console.log("OK test-prod-camera-only");
