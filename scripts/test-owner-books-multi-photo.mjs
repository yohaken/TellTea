/**
 * Owner-books multi-receipt wiring must mirror /ledger (owner account):
 * PhotoAttachMultiField + data URL path — no Storage uploadFile hang.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libSrc = readFileSync(join(root, "src/lib/owner-books.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const ledgerPageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const multiSrc = readFileSync(join(root, "src/components/PhotoAttachMultiField.tsx"), "utf8");
const photoUploadSrc = readFileSync(join(root, "src/lib/photo-upload.ts"), "utf8");

assert.match(libSrc, /OWNER_BOOKS_RECEIPT_MAX\s*=\s*6/);
assert.match(libSrc, /getOwnerBookReceiptUrls/);
assert.match(libSrc, /receiptUrls/);
assert.match(pageSrc, /PhotoAttachMultiField/);
assert.match(pageSrc, /OWNER_BOOKS_RECEIPT_MAX/);
assert.match(pageSrc, /EntryPhotoIndicator/);
assert.match(pageSrc, /ดูรูปทั้งหมด/);
assert.match(pageSrc, /สูงสุด \$\{OWNER_BOOKS_RECEIPT_MAX\} รูป/);
// Must NOT use Storage uploadAppPhoto — that hung mobile on 「กำลังอัปโหลด...」
assert.doesNotMatch(pageSrc, /uploadAppPhoto/);
assert.doesNotMatch(pageSrc, /uploadFile=/);
assert.doesNotMatch(pageSrc, /setReceiptFile/);
assert.doesNotMatch(pageSrc, /files\?\.\[0\]/);
// Same attach label/max pattern as ledger
assert.match(ledgerPageSrc, /label="สลิป \/ รูปถ่าย"/);
assert.match(pageSrc, /label="สลิป \/ รูปถ่าย"/);
assert.match(multiSrc, /\bmultiple\b/);
assert.match(multiSrc, /45_000/);
assert.match(photoUploadSrc, /STORAGE_UPLOAD_TIMEOUT_MS/);

function getOwnerBookReceiptUrls(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.receiptUrls) && entry.receiptUrls.length) {
    const urls = entry.receiptUrls.map(String).filter((u) => u.trim());
    if (urls.length) return urls.slice(0, 6);
  }
  const legacy = (entry.receiptUrl || "").trim();
  return legacy ? [legacy] : [];
}

assert.deepEqual(getOwnerBookReceiptUrls({ receiptUrl: "a" }), ["a"]);
assert.deepEqual(getOwnerBookReceiptUrls({ receiptUrls: ["a", "b"], receiptUrl: "a" }), [
  "a",
  "b",
]);
assert.deepEqual(getOwnerBookReceiptUrls({ receiptUrls: [], receiptUrl: "legacy" }), ["legacy"]);
assert.deepEqual(getOwnerBookReceiptUrls(null), []);

console.log("OK test-owner-books-multi-photo");
