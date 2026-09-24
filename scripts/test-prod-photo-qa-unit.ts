/**
 * Unit: buildProdPhotoQa fail-closed + staff confirm (tsx).
 */
import assert from "node:assert/strict";
import {
  buildProdPhotoQa,
  findConfusionGroupForProductName,
  shouldRunProdPhotoConflictAi,
} from "../src/lib/prod-photo-qa";
import { prodEntryCountsTowardBonus } from "../src/lib/production";

const outage = {
  conflictLevel: "uncertain" as const,
  suggestedProductName: "",
  reason: "หมดเวลารอ AI",
  model: "",
  usedImages: 0,
  skipped: true,
  skipReason: "หมดเวลารอ AI",
};

const pending = buildProdPhotoQa({
  productId: "p1",
  productName: "ขนมปังมันม่วง",
  result: outage,
  flaggedBy: "ai_outage",
});
assert.equal(pending.verifyStatus, "pending");
assert.equal(
  prodEntryCountsTowardBonus({ status: "unpaid", photoQa: pending }),
  false,
);

const confirmed = buildProdPhotoQa({
  productId: "p1",
  productName: "ขนมปังมันม่วง",
  result: outage,
  staffConfirmedPhotoMatch: true,
});
assert.equal(confirmed.verifyStatus, "conflict_confirmed");
assert.equal(confirmed.staffAction, "confirmed");
assert.equal(
  Object.prototype.hasOwnProperty.call(confirmed, "aiSuggestedProductName"),
  false,
  "empty AI suggestion must not write undefined field",
);
for (const [k, v] of Object.entries(confirmed)) {
  assert.notEqual(v, undefined, `photoQa.${k} must not be undefined`);
}
assert.equal(
  prodEntryCountsTowardBonus({ status: "unpaid", photoQa: confirmed }),
  true,
);

const conflict = {
  conflictLevel: "conflict" as const,
  suggestedProductName: "มันอบ",
  reason: "ดูเป็นมันอบ",
  model: "t",
  usedImages: 1,
};
const flagged = buildProdPhotoQa({
  productId: "p1",
  productName: "ขนมปังมันม่วง",
  result: conflict,
});
assert.equal(flagged.verifyStatus, "flagged");
assert.equal(
  prodEntryCountsTowardBonus({ status: "unpaid", photoQa: flagged }),
  false,
);

assert.equal(shouldRunProdPhotoConflictAi("ขนมปังมันม่วง"), true);
assert.equal(shouldRunProdPhotoConflictAi("ซอฟคุ๊กกี้-โกโก้"), false);
assert.equal(findConfusionGroupForProductName("ซอฟคุ๊กกี้-มัจฉะ")?.flavorBlind, true);

console.log("ok: prod-photo-qa unit fail-closed");
