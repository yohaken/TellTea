/**
 * OT multi-product-photo helpers — imageUrls + size budget + form wiring.
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
const receiptsSrc = readFileSync(join(root, "src/lib/receipts.ts"), "utf8");

assert.match(otSrc, /OT_IMAGE_MAX\s*=\s*10/);
assert.match(otSrc, /OT_IMAGE_PAYLOAD_BUDGET\s*=\s*650_000/);
assert.match(otSrc, /assertOtImageUrlsFit/);
assert.match(otSrc, /getOtImageUrls/);
assert.match(otSrc, /imageUrls/);
assert.match(otSrc, /mapOtEntryDoc/);
assert.match(pageSrc, /PhotoAttachMultiField/);
assert.match(pageSrc, /OT_IMAGE_MAX/);
assert.match(pageSrc, /OT_IMAGE_PAYLOAD_BUDGET/);
assert.match(pageSrc, /EntryPhotoIndicator/);
assert.match(pageSrc, /onPreview=\{\(urls, index\)/);
assert.match(pageSrc, /onAdd=/);
assert.match(pageSrc, /formError/);
assert.match(pageSrc, /friendlyFirestoreWriteError/);
assert.match(pageSrc, /กะนี้มีรายการแล้ว/);
assert.doesNotMatch(pageSrc, /imageUrls:\s*\[\],/);
assert.match(multiSrc, /allowCamera/);
assert.match(multiSrc, /capture="environment"/);
assert.match(multiSrc, /maxTotalChars/);
assert.match(multiSrc, /onPreview\?\.\(values, idx\)/);
assert.match(cellSrc, /photo-status-count/);
assert.match(cellSrc, /photo-status-plus/);
assert.match(cellSrc, /initialIndex/);
assert.match(receiptsSrc, /friendlyFirestoreWriteError/);
assert.match(receiptsSrc, /RECEIPT_DATA_URL_HARD_MAX/);

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

function otImagePayloadChars(urls) {
  const cleaned = urls.map((u) => u.trim()).filter(Boolean);
  if (!cleaned.length) return 0;
  return cleaned.reduce((n, u) => n + u.length, 0) + cleaned[0].length;
}

function assertOtImageUrlsFit(urls, max = 10, budget = 720_000) {
  const capped = urls
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, max);
  const dataOnly = capped.filter((u) => u.trim().toLowerCase().startsWith("data:"));
  if (dataOnly.length) {
    const chars = otImagePayloadChars(dataOnly);
    if (chars > budget) throw new Error("budget");
  }
  return capped;
}

assert.deepEqual(getOtImageUrls({ imageUrl: "a" }), ["a"]);
assert.deepEqual(getOtImageUrls({ imageUrls: ["a", "b"], imageUrl: "a" }), ["a", "b"]);
assert.deepEqual(getOtImageUrls({ imageUrls: [], imageUrl: "legacy" }), ["legacy"]);
assert.deepEqual(getOtImageUrls({ imageUrls: ["", "  "], imageUrl: "legacy" }), ["legacy"]);
assert.deepEqual(getOtImageUrls({ imageUrls: [] }), []);
assert.deepEqual(getOtImageUrls(null), []);

assert.equal(otImagePayloadChars(["abc"]), 6);
assert.equal(otImagePayloadChars(["aa", "bb"]), 6);
assert.deepEqual(assertOtImageUrlsFit(["x", "y"]), ["x", "y"]);
assert.throws(() =>
  assertOtImageUrlsFit([
    "data:image/jpeg;base64," + "a".repeat(400_000),
    "data:image/jpeg;base64," + "b".repeat(400_000),
  ]),
);

console.log("OK test-ot-multi-photo");
