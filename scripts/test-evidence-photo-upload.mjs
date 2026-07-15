/**
 * Evidence photo path uses Firestore docs + progress, not hanging Storage CF.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/photo-upload.ts"), "utf8");
const evidence = readFileSync(join(root, "src/lib/evidence-photos.ts"), "utf8");

assert.match(src, /saveEvidencePhotoDoc/);
assert.match(src, /keepAsIs/);
assert.match(src, /No Storage hang|one Firestore doc per photo|evp:/);
assert.match(evidence, /export async function saveEvidencePhotoDoc/);
assert.match(evidence, /export async function resolveEvidencePhotoSrc/);
assert.doesNotMatch(src, /uploadViaCloudFunctionBytes/);

console.log("OK test-evidence-photo-upload");
