/**
 * Smoke: channel normalize + fee/VAT helpers mirrored from capture extract
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fn = readFileSync(
  join(root, "functions/vat-delivery-capture-extract.js"),
  "utf8",
);
assert.match(fn, /vatDeliveryCaptureExtract/);
assert.match(fn, /grab\|shopee\|lineman/);
assert.match(fn, /MAX_IMAGES = 3/);

const ui = readFileSync(
  join(root, "src/components/vat-sales/VatIngestSources.tsx"),
  "utf8",
);
assert.match(ui, /extractDeliveryCaptures/);
assert.match(ui, /ให้ AI คัดแยก/);
assert.doesNotMatch(ui, /เชื่อม Gmail|ดึง SF\+LM|extractGrabFinanceImage/);

const index = readFileSync(join(root, "functions/index.js"), "utf8");
assert.match(index, /vatDeliveryCaptureExtract/);
assert.doesNotMatch(index, /vatGrabImageExtract|vatMailPullMonthlySources/);

console.log("test-vat-delivery-capture-extract: ok");
