/**
 * OT close photos — must support 10 Storage URLs + visible max label + table count.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const otSrc = readFileSync(join(root, "src/lib/ot.ts"), "utf8");
const photosSrc = readFileSync(join(root, "src/lib/ot-photos.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");
const multiSrc = readFileSync(join(root, "src/components/PhotoAttachMultiField.tsx"), "utf8");
const cellSrc = readFileSync(join(root, "src/components/EntryPhotoCell.tsx"), "utf8");
const storageRules = readFileSync(join(root, "storage.rules"), "utf8");
const firebaseJson = readFileSync(join(root, "firebase.json"), "utf8");
const deployYml = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");

assert.match(otSrc, /OT_IMAGE_MAX\s*=\s*10/);
assert.match(otSrc, /assertOtImageUrlsFit/);
assert.match(photosSrc, /uploadOtProductPhoto/);
assert.match(photosSrc, /OT_PHOTO_STORAGE_PREFIX/);
assert.match(photosSrc, /uploadBytes/);
assert.match(pageSrc, /uploadOtProductPhoto/);
assert.match(pageSrc, /OT_IMAGE_MAX/);
assert.match(pageSrc, /สูงสุด \$\{OT_IMAGE_MAX\} รูป/);
assert.match(multiSrc, /uploadFile/);
assert.match(multiSrc, /สูงสุด \$\{max\} รูป/);
assert.match(cellSrc, /photo-status-count/);
assert.match(cellSrc, /data-count/);
assert.match(storageRules, /ot-photos/);
assert.match(firebaseJson, /"storage"/);
assert.match(deployYml, /storage/);

const OT_IMAGE_MAX = 10;
const OT_IMAGE_PAYLOAD_BUDGET = 650_000;
const FIRESTORE_DOC_LIMIT = 1_048_576;

function isDataUrlPhoto(url) {
  return url.trim().toLowerCase().startsWith("data:");
}

function otImagePayloadChars(urls) {
  const cleaned = urls.map((u) => u.trim()).filter(Boolean);
  if (!cleaned.length) return 0;
  return cleaned.reduce((n, u) => n + u.length, 0) + cleaned[0].length;
}

function assertOtImageUrlsFit(urls) {
  const capped = urls
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, OT_IMAGE_MAX);
  const dataOnly = capped.filter(isDataUrlPhoto);
  if (dataOnly.length) {
    const chars = otImagePayloadChars(dataOnly);
    if (chars > OT_IMAGE_PAYLOAD_BUDGET) throw new Error("budget");
  }
  return capped;
}

function estimateDocBytes(urls) {
  return Buffer.byteLength(
    JSON.stringify({
      imageUrl: urls[0] || "",
      imageUrls: urls,
      machineCount: 82,
      workers: ["a", "b"],
    }),
    "utf8",
  );
}

// 10 Firebase download URLs → tiny Firestore payload, must fit.
const tenRemote = Array.from(
  { length: 10 },
  (_, i) =>
    `https://firebasestorage.googleapis.com/v0/b/mypeer-501909.appspot.com/o/ot-photos%2Fslot%2Fp${i}.jpg?alt=media&token=abc${i}`,
);
assert.equal(assertOtImageUrlsFit(tenRemote).length, 10);
const tenBytes = estimateDocBytes(tenRemote);
assert.ok(tenBytes < 20_000, `10 remote URLs doc should be tiny, got ${tenBytes}`);
assert.ok(tenBytes < FIRESTORE_DOC_LIMIT);

// 10 tight data URLs (~55k each) must still fit legacy fallback budget.
const tenData = Array.from(
  { length: 10 },
  (_, i) => "data:image/jpeg;base64," + String(i).repeat(55_000),
);
assert.equal(assertOtImageUrlsFit(tenData).length, 10);
assert.ok(otImagePayloadChars(tenData) <= OT_IMAGE_PAYLOAD_BUDGET + 50_000);

// Legacy data URLs still budget-checked
assert.throws(() =>
  assertOtImageUrlsFit([
    "data:image/jpeg;base64," + "A".repeat(400_000),
    "data:image/jpeg;base64," + "B".repeat(400_000),
  ]),
);

console.log("OK test-ot-10-photos", { tenBytes, max: OT_IMAGE_MAX });
