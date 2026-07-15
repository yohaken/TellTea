/**
 * Owner-books evidence photos: Firestore one-doc-per-photo (evp:) — no Storage hang.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libSrc = readFileSync(join(root, "src/lib/owner-books.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const multiSrc = readFileSync(join(root, "src/components/PhotoAttachMultiField.tsx"), "utf8");
const photoUploadSrc = readFileSync(join(root, "src/lib/photo-upload.ts"), "utf8");
const evidenceSrc = readFileSync(join(root, "src/lib/evidence-photos.ts"), "utf8");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

assert.match(libSrc, /OWNER_BOOKS_RECEIPT_MAX\s*=\s*6/);
assert.match(pageSrc, /storageFolder="owner-books"/);
assert.match(pageSrc, /PhotoAttachMultiField/);
assert.match(multiSrc, /uploadEvidencePhotos/);
assert.match(multiSrc, /resolveEvidencePhotoSrc/);
assert.match(photoUploadSrc, /saveEvidencePhotoDoc/);
assert.match(evidenceSrc, /EVIDENCE_PHOTO_PREFIX\s*=\s*"evp:"/);
assert.match(evidenceSrc, /evidencePhotos/);
assert.match(rules, /match \/evidencePhotos\/\{photoId\}/);
assert.match(rules, /dataUrl\.size\(\) < 950000/);

console.log("OK test-owner-books-multi-photo");
