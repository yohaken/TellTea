/**
 * Evidence upload goes through Cloud Functions (Admin Storage) — not Drive.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fnIndex = readFileSync(join(root, "functions/index.js"), "utf8");
const evidence = readFileSync(join(root, "functions/evidence-upload.js"), "utf8");
const photoUpload = readFileSync(join(root, "src/lib/photo-upload.ts"), "utf8");
const deploy = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");

assert.match(fnIndex, /uploadEvidencePhoto/);
assert.match(fnIndex, /createEvidenceUpload/);
assert.match(fnIndex, /finalizeEvidenceUpload/);
assert.match(evidence, /uploadEvidencePhoto/);
assert.match(evidence, /getSignedUrl/);
assert.match(evidence, /firebaseStorageDownloadTokens/);
assert.match(evidence, /mypeer-501909\.firebasestorage\.app/);
assert.match(photoUpload, /uploadViaCloudFunctionBytes/);
assert.match(photoUpload, /uploadViaSignedUrl/);
assert.match(photoUpload, /uploadEvidencePhoto/);
assert.match(deploy, /TELLTEA_STORAGE_BUCKET/);

console.log("OK test-evidence-cf-upload");
