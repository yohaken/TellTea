/**
 * Production: camera-only. OT: multi photo (gallery + camera) restored.
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

assert.match(ot, /PhotoAttachMultiField/);
assert.match(ot, /OT_IMAGE_MAX/);
assert.doesNotMatch(ot, /allowGallery=\{false\}/);
assert.doesNotMatch(ot, /requireLiveCapture/);

assert.match(multi, /allowGallery/);
assert.match(multi, /requireLiveCapture/);
assert.match(version, /APP_BUILD\s*=\s*274/);

console.log("OK test-prod-camera-only");
