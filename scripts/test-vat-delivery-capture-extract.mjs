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
assert.match(ui, /อ่านรูปใหม่/);
assert.match(ui, /ส่งเข้าตารางหลัก/);
assert.match(ui, /saveIngestDraft|เซฟ/);
assert.match(ui, /ghost-btn vat-sales-act-btn/);
assert.match(ui, /primary-btn vat-sales-act-btn/);
assert.match(ui, />\s*ล้าง\s*</);
assert.doesNotMatch(ui, /VatMonthProcessNotes|โน้ต \/ พรอมต์/);
assert.doesNotMatch(ui, /เชื่อม Gmail|ดึง SF\+LM|extractGrabFinanceImage/);
assert.match(fn, /คชจ\.GP ต้องเป็นยอดก่อน VAT|ex-VAT|×7\/107/);
assert.match(fn, /extractLooseFields/);

const draft = readFileSync(
  join(root, "src/lib/vat-delivery-ingest-draft.ts"),
  "utf8",
);
assert.match(draft, /vatDeliveryIngestDrafts/);
assert.match(draft, /uploadIngestCaptureFile/);
assert.match(draft, /compressCaptureToJpeg|withTimeout/);

const index = readFileSync(join(root, "functions/index.js"), "utf8");
assert.match(index, /vatDeliveryCaptureExtract/);
assert.doesNotMatch(index, /vatGrabImageExtract|vatMailPullMonthlySources/);

console.log("test-vat-delivery-capture-extract: ok");
