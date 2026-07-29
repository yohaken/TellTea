/**
 * Pure tests for owner-books VAT slot helpers.
 */
import assert from "node:assert/strict";
import {
  normalizeOwnerBookVat,
  proposeOwnerBookVatInput,
} from "../src/lib/owner-books";

assert.equal(proposeOwnerBookVatInput(107), 7);
assert.equal(proposeOwnerBookVatInput(0), 0);

{
  const off = normalizeOwnerBookVat({ hasVat: false }, 107);
  assert.equal(off.hasVat, false);
  assert.equal(off.vatInput, 0);
  assert.equal(off.vatBase, 0);
}

{
  const on = normalizeOwnerBookVat({ hasVat: true }, 107);
  assert.equal(on.hasVat, true);
  assert.equal(on.vatInput, 7);
  assert.equal(on.vatBase, 100);
}

{
  const custom = normalizeOwnerBookVat(
    { hasVat: true, vatInput: 5.5, vatInvoiceNo: " INV-1 " },
    107,
  );
  assert.equal(custom.vatInput, 5.5);
  assert.equal(custom.vatInvoiceNo, "INV-1");
}

console.log("test-owner-books-vat-logic: ok");
