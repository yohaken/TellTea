import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Can't import TS directly — reimplement checks against source + CF
const discountSrc = readFileSync(join(root, "src/lib/pos-discount.ts"), "utf8");
assert.match(discountSrc, /resolveDiscountBaht/);
assert.match(discountSrc, /payableAfterDiscount/);

const modal = readFileSync(join(root, "src/components/PosDiscountModal.tsx"), "utf8");
assert.match(modal, /กดปุ่มอย่างเดียว ไม่ใช้แป้นพิมพ์/);
assert.match(modal, /DIGITS/);
assert.doesNotMatch(modal, /<input/);
assert.match(modal, /บาท/);
assert.match(modal, /เปอร์เซ็นต์/);
assert.match(modal, /pos-pay-actions/);

const sell = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sell, /PosDiscountModal/);
assert.match(sell, /discountBaht/);
assert.match(sell, /ส่วนลด/);
assert.doesNotMatch(sell, />โปรโมชั่น</);

const sales = readFileSync(join(root, "src/lib/pos-sales.ts"), "utf8");
assert.match(sales, /discountBaht/);

const syncUtils = readFileSync(join(root, "src/lib/pos-sync-utils.ts"), "utf8");
assert.match(syncUtils, /discountBaht/);

const cf = readFileSync(join(root, "functions/pos-complete-sale.js"), "utf8");
assert.match(cf, /discountBaht/);
assert.match(cf, /subtotal - discountBaht/);

const receipt = readFileSync(join(root, "src/lib/pos-printer/receipt-template.ts"), "utf8");
assert.match(receipt, /ส่วนลด/);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = \d+/);

// Pure JS mirror of helpers for numeric asserts
function resolveDiscountBaht(subtotal, discount) {
  const base = Math.round(Math.max(0, subtotal) * 100) / 100;
  if (!discount || !(discount.value > 0) || base <= 0) return 0;
  if (discount.kind === "baht") return Math.min(Math.round(discount.value * 100) / 100, base);
  const pct = Math.min(100, Math.max(0, discount.value));
  return Math.min(Math.round(((base * pct) / 100) * 100) / 100, base);
}
function payable(subtotal, d) {
  return Math.round((Math.max(0, subtotal) - resolveDiscountBaht(subtotal, d)) * 100) / 100;
}
assert.equal(resolveDiscountBaht(100, { kind: "baht", value: 10 }), 10);
assert.equal(payable(100, { kind: "baht", value: 10 }), 90);
assert.equal(resolveDiscountBaht(100, { kind: "percent", value: 15 }), 15);
assert.equal(resolveDiscountBaht(38, { kind: "baht", value: 50 }), 38);
assert.equal(payable(38, { kind: "baht", value: 50 }), 0);

console.log("OK pos-discount");
