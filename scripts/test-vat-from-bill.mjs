/**
 * Top World bill math: base + gross → VAT (no ×7/107 invent from gross alone).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  completeVatFromBill,
  fillVatFromBaseAndGross,
} = require(join(dirname(fileURLToPath(import.meta.url)), "../functions/vat-from-bill.js"));

// Real Top World slip: total 5743, base 5367.29, VAT 375.71
const filled = fillVatFromBaseAndGross(
  { hasVat: false, vatInput: null, vatBase: 5367.29, vatInvoiceNo: "", vatSeenOnBill: false, vatReason: "" },
  5743,
);
assert.equal(filled.vatInput, 375.71);
assert.equal(filled.hasVat, true);
assert.equal(filled.vatSeenOnBill, true);

const complete = completeVatFromBill(
  { hasVat: false, vatInput: null, vatBase: 5367.29, vatInvoiceNo: "", vatSeenOnBill: false, vatReason: "" },
  5743,
);
assert.equal(complete.vatInput, 375.71);

// Must NOT invent from gross alone
const noBase = fillVatFromBaseAndGross(
  { hasVat: false, vatInput: null, vatBase: null, vatInvoiceNo: "", vatSeenOnBill: false, vatReason: "" },
  5743,
);
assert.equal(noBase.vatInput, null);

// Reject when base/gross gap is not ~7%
const bad = fillVatFromBaseAndGross(
  { hasVat: false, vatInput: null, vatBase: 1000, vatInvoiceNo: "", vatSeenOnBill: false, vatReason: "" },
  2000,
);
assert.equal(bad.vatInput, null);

// Fill base from input + gross
const withBase = completeVatFromBill(
  { hasVat: true, vatInput: 375.71, vatBase: null, vatInvoiceNo: "", vatSeenOnBill: true, vatReason: "" },
  5743,
);
assert.equal(withBase.vatBase, 5367.29);

console.log("OK test-vat-from-bill");
