/**
 * OT photo save — multi-photo budget + amend-closed gate logic.
 * Simulates realistic JPEG data-URL sizes and Firestore 1 MiB doc limit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const otSrc = readFileSync(join(root, "src/lib/ot.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ot/page.tsx"), "utf8");

assert.match(otSrc, /OT_IMAGE_MAX\s*=\s*10/);
assert.match(otSrc, /isOtEntryClosed/);
assert.match(otSrc, /assertOtImageUrlsFit/);
assert.match(pageSrc, /amendClosed/);
assert.match(pageSrc, /บันทึกการแก้ไข/);
assert.match(pageSrc, /saveBlockedReason/);
assert.match(pageSrc, /canSaveClose/);
assert.match(pageSrc, /updateOtEntry\(entry\.id, payload\)/);

const OT_IMAGE_MAX = 10;
const OT_IMAGE_PAYLOAD_BUDGET = 650_000;
const FIRESTORE_DOC_LIMIT = 1_048_576;

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
  const dataOnly = capped.filter((u) => u.trim().toLowerCase().startsWith("data:"));
  if (dataOnly.length) {
    const chars = otImagePayloadChars(dataOnly);
    if (chars > OT_IMAGE_PAYLOAD_BUDGET) {
      throw new Error(`รูปใหญ่รวมกันเกินไป (${dataOnly.length} รูป)`);
    }
  }
  return capped;
}

function hasOtQuantities(entry) {
  return (
    (Number(entry.machineCount) || 0) +
      (Number(entry.otherCups) || 0) +
      (Number(entry.iceCreamCones) || 0) +
      (Number(entry.breadSlices) || 0) +
      (Number(entry.claimCups) || 0) +
      (Number(entry.deductQty) || 0) +
      (Number(entry.addQty) || 0) >
    0
  );
}

function isOtEntryClosed(entry) {
  if (!entry) return false;
  return hasOtQuantities(entry) || !!entry.shiftClosedAt;
}

/** Fake JPEG data URL of ~targetChars (base64-ish body). */
function fakePhoto(targetChars) {
  const prefix = "data:image/jpeg;base64,";
  return prefix + "A".repeat(Math.max(0, targetChars - prefix.length));
}

function estimateOtDocBytes(urls, extra = 2500) {
  // Rough: JSON with duplicated imageUrl + imageUrls array + other fields
  const payload = {
    imageUrl: urls[0] || "",
    imageUrls: urls,
    workers: ["a", "b"],
    machineCount: 82,
    note: "x".repeat(200),
  };
  return Buffer.byteLength(JSON.stringify(payload), "utf8") + extra;
}

function canSaveClose({
  busy,
  workers,
  selectedWorkers,
  summaryQty,
  amendClosed,
  checkLoading,
  checkSession,
  missingLabels,
}) {
  return (
    !busy &&
    !!workers &&
    selectedWorkers > 0 &&
    summaryQty > 0 &&
    (amendClosed || (!checkLoading && !!checkSession && missingLabels === 0))
  );
}

// --- Multi photo size: 2 medium photos must fit and stay under 1 MiB doc ---
const twoMedium = [fakePhoto(180_000), fakePhoto(180_000)];
assert.deepEqual(assertOtImageUrlsFit(twoMedium).length, 2);
assert.ok(otImagePayloadChars(twoMedium) < OT_IMAGE_PAYLOAD_BUDGET);
const twoBytes = estimateOtDocBytes(twoMedium);
assert.ok(
  twoBytes < FIRESTORE_DOC_LIMIT,
  `2 medium photos doc ${twoBytes} should be < 1MiB`,
);

// 3 smaller photos OK
const threeSmall = [fakePhoto(140_000), fakePhoto(140_000), fakePhoto(140_000)];
assert.deepEqual(assertOtImageUrlsFit(threeSmall).length, 3);
assert.ok(estimateOtDocBytes(threeSmall) < FIRESTORE_DOC_LIMIT);

// Over budget rejected before Firestore
assert.throws(() =>
  assertOtImageUrlsFit([fakePhoto(400_000), fakePhoto(400_000), fakePhoto(400_000)]),
);

// --- Amend closed: save enabled WITHOUT SmartCheck / SOP ---
assert.equal(isOtEntryClosed({ machineCount: 82, workerNames: ["A"] }), true);
assert.equal(isOtEntryClosed({ machineCount: 0, workerNames: ["A"] }), false);
assert.equal(
  isOtEntryClosed({ machineCount: 0, workerNames: ["A"], shiftClosedAt: 1 }),
  true,
);

assert.equal(
  canSaveClose({
    busy: false,
    workers: true,
    selectedWorkers: 1,
    summaryQty: 82,
    amendClosed: true,
    checkLoading: false,
    checkSession: null, // no SmartCheck — still OK for amend
    missingLabels: 2, // SOP incomplete — still OK for amend
  }),
  true,
);

// New close: still blocked without SmartCheck / with missing SOP
assert.equal(
  canSaveClose({
    busy: false,
    workers: true,
    selectedWorkers: 1,
    summaryQty: 82,
    amendClosed: false,
    checkLoading: false,
    checkSession: null,
    missingLabels: 0,
  }),
  false,
);

assert.equal(
  canSaveClose({
    busy: false,
    workers: true,
    selectedWorkers: 1,
    summaryQty: 82,
    amendClosed: false,
    checkLoading: false,
    checkSession: { id: "x" },
    missingLabels: 2,
  }),
  false,
);

assert.equal(
  canSaveClose({
    busy: false,
    workers: true,
    selectedWorkers: 1,
    summaryQty: 82,
    amendClosed: false,
    checkLoading: false,
    checkSession: { id: "x" },
    missingLabels: 0,
  }),
  true,
);

console.log("OK test-ot-photo-save-amend", {
  twoBytes,
  threeBytes: estimateOtDocBytes(threeSmall),
});
