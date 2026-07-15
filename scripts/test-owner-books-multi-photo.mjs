/**
 * Owner-books uses canonical Storage evidence upload prototype
 * (progress popup + real URLs — no Firestore data-URL embed).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libSrc = readFileSync(join(root, "src/lib/owner-books.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const multiSrc = readFileSync(join(root, "src/components/PhotoAttachMultiField.tsx"), "utf8");
const progressSrc = readFileSync(
  join(root, "src/components/PhotoUploadProgressModal.tsx"),
  "utf8",
);
const photoUploadSrc = readFileSync(join(root, "src/lib/photo-upload.ts"), "utf8");
const storageRules = readFileSync(join(root, "storage.rules"), "utf8");

assert.match(libSrc, /OWNER_BOOKS_RECEIPT_MAX\s*=\s*6/);
assert.match(pageSrc, /PhotoAttachMultiField/);
assert.match(pageSrc, /storageFolder="owner-books"/);
assert.match(pageSrc, /storageSlotKey=/);
assert.match(pageSrc, /startsWith\("data:"\)/);
assert.doesNotMatch(pageSrc, /uploadFile=/);
assert.match(multiSrc, /uploadEvidencePhotos/);
assert.match(multiSrc, /PhotoUploadProgressModal/);
assert.match(multiSrc, /\bmultiple\b/);
assert.match(progressSrc, /อัปโหลดรูปหลักฐาน/);
assert.match(progressSrc, /การเชื่อมต่อ/);
assert.match(photoUploadSrc, /uploadEvidencePhotos/);
assert.match(photoUploadSrc, /prepareEvidencePhoto/);
assert.match(photoUploadSrc, /uploadViaCloudFunctionBytes/);
assert.match(photoUploadSrc, /EVIDENCE_MAX_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
assert.match(storageRules, /12\s*\*\s*1024\s*\*\s*1024/);
assert.match(storageRules, /owner-books/);

console.log("OK test-owner-books-multi-photo");
