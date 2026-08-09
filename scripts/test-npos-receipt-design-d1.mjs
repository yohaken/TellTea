/**
 * Receipt design D1 — BO slip designer + logo on unified preview (not old template).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const settings = read("src/lib/pos-settings.ts");
assert.match(settings, /receiptPrintLogo/);
assert.match(settings, /receiptPrintLogo: true/);
assert.match(settings, /receiptPrintLogo !== false/);

const types = read("src/lib/pos-printer/types.ts");
assert.match(types, /shopLogoDataUrl/);

const template = read("src/lib/pos-printer/receipt-template.ts");
assert.match(template, /shop-logo/);
assert.match(template, /shopLogoDataUrl/);
assert.match(template, /buildUnifiedReceiptBody/);
assert.match(template, /applyShopToReceiptSample/);
assert.doesNotMatch(template, /legacyReceiptTemplate|oldReceiptBody/);

const view = read("src/components/PosBusinessSettingsView.tsx");
assert.match(view, /หัวสลิป/);
assert.match(view, /แสดงโลโก้บนใบเสร็จ/);
assert.match(view, /BusinessLogoField/);
assert.match(view, /receiptPrintLogo/);
assert.match(view, /buildUnifiedReceiptBody/);
assert.match(view, /shopLogoDataUrl/);
assert.doesNotMatch(view, /เทมเพลตเก่า|สวิตช์เทมเพลต/);

const api = read("functions/npos-sell.js");
assert.match(api, /receiptPrintLogo/);
assert.match(api, /receiptPrintLogo: x\.receiptPrintLogo !== false/);

const css = read("src/app/globals.css");
assert.match(css, /\.pos-biz-slip-head/);
assert.match(css, /\.pos-biz-logo-block/);

const phases = read("docs/npos-receipt-design-phases.md");
assert.match(phases, /เปิดเลย/);
assert.match(phases, /เครื่องเดิม/);

console.log("OK npos-receipt-design-d1");
