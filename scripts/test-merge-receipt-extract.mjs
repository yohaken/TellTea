/**
 * Multi-photo merge: bank slip + Top World tax invoice → VAT from invoice only.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  mergeExtractResults,
  normalizeDocKind,
} = require(join(dirname(fileURLToPath(import.meta.url)), "../functions/merge-receipt-extract.js"));

assert.equal(normalizeDocKind("bank_slip"), "bank_slip");
assert.equal(normalizeDocKind("tax_invoice"), "tax_invoice");
assert.equal(normalizeDocKind("สลิปโอน"), "bank_slip");
assert.equal(normalizeDocKind("ใบกำกับภาษี"), "tax_invoice");

const bank = {
  docKind: "bank_slip",
  date: "2026-07-29",
  description: "โอนค่าของ",
  amountOut: 5743,
  type: "cogs",
  note: "",
  reason: "สลิปโอน",
  hasVat: false,
  vatInput: null,
  vatBase: null,
  vatInvoiceNo: "",
  vatSeenOnBill: false,
  vatReason: "สลิปโอนเงิน — ไม่ใช้เป็นแหล่ง VAT",
};

const tax = {
  docKind: "tax_invoice",
  date: "2026-07-29",
  description: "ท็อปเวิลด์",
  amountOut: 5743,
  type: "cogs",
  note: "",
  reason: "ใบเสร็จท็อปเวิลด์",
  hasVat: true,
  vatInput: 375.71,
  vatBase: 5367.29,
  vatInvoiceNo: "",
  vatSeenOnBill: true,
  vatReason: "ภาษีมูลค่าเพิ่ม 7% ท้ายบิล",
};

// Order: transfer first (common), tax second — must still pick VAT from tax
const merged = mergeExtractResults([bank, tax]);
assert.equal(merged.hasVat, true);
assert.equal(merged.vatInput, 375.71);
assert.equal(merged.vatBase, 5367.29);
assert.equal(merged.description, "ท็อปเวิลด์");
assert.equal(merged.amountOut, 5743);

// Reverse order
const merged2 = mergeExtractResults([tax, bank]);
assert.equal(merged2.vatInput, 375.71);

// Bank only — no invented VAT
const bankOnly = mergeExtractResults([bank]);
assert.equal(bankOnly.hasVat, false);
assert.equal(bankOnly.vatInput, null);

// Tax without VAT line — stay null (no ×7/107)
const taxNoVat = mergeExtractResults([
  {
    ...tax,
    hasVat: false,
    vatInput: null,
    vatBase: null,
    vatSeenOnBill: false,
    vatReason: "ไม่เห็นบรรทัดภาษี",
  },
]);
assert.equal(taxNoVat.hasVat, false);
assert.equal(taxNoVat.vatInput, null);

console.log("OK test-merge-receipt-extract");
