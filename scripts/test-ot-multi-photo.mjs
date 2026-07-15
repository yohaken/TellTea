/**
 * OT multi-product-photo helpers — imageUrls + legacy imageUrl + form wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const otSrc = readFileSync(join(root, "src/lib/ot.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");
const multiSrc = readFileSync(join(root, "src/components/PhotoAttachMultiField.tsx"), "utf8");
const cellSrc = readFileSync(join(root, "src/components/EntryPhotoCell.tsx"), "utf8");

assert.match(otSrc, /OT_IMAGE_MAX\s*=\s*8/);
assert.match(otSrc, /getOtImageUrls/);
assert.match(otSrc, /imageUrls/);
assert.match(otSrc, /mapOtEntryDoc/);
assert.match(pageSrc, /PhotoAttachMultiField/);
assert.match(pageSrc, /OT_IMAGE_MAX/);
assert.match(pageSrc, /EntryPhotoIndicator/);
assert.match(pageSrc, /onPreview=\{\(urls, index\)/);
assert.match(pageSrc, /onAdd=/);
assert.doesNotMatch(pageSrc, /imageUrls:\s*\[\],/);
assert.match(multiSrc, /allowCamera/);
assert.match(multiSrc, /capture="environment"/);
assert.match(multiSrc, /onPreview\?\.\(values, idx\)/);
assert.match(cellSrc, /photo-status-count/);
assert.match(cellSrc, /photo-status-plus/);
assert.match(cellSrc, /initialIndex/);

/** Mirror getOtImageUrls — empty imageUrls must fall back to legacy imageUrl */
function getOtImageUrls(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.imageUrls) && entry.imageUrls.length) {
    const urls = entry.imageUrls.map(String).filter((u) => u.trim());
    if (urls.length) return urls;
  }
  if (entry.imageUrl?.trim()) return [entry.imageUrl.trim()];
  return [];
}

assert.deepEqual(getOtImageUrls({ imageUrl: "a" }), ["a"]);
assert.deepEqual(getOtImageUrls({ imageUrls: ["a", "b"], imageUrl: "a" }), ["a", "b"]);
assert.deepEqual(getOtImageUrls({ imageUrls: [], imageUrl: "legacy" }), ["legacy"]);
assert.deepEqual(getOtImageUrls({ imageUrls: ["", "  "], imageUrl: "legacy" }), ["legacy"]);
assert.deepEqual(getOtImageUrls({ imageUrls: [] }), []);
assert.deepEqual(getOtImageUrls(null), []);

console.log("OK test-ot-multi-photo");
