/**
 * VAT month: + expand breakdown of books VAT lines.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = readFileSync(join(root, "src/lib/books-vat-month.ts"), "utf8");
const ui = readFileSync(
  join(root, "src/components/vat-sales/VatMonthBooks.tsx"),
  "utf8",
);

assert.match(lib, /loadBothBooksVatByMonth/);
assert.match(lib, /BooksVatLine/);
assert.match(lib, /bookLabel/);
assert.match(lib, /sumBothBooksVatInputByMonth/);
assert.match(lib, /vatClaim/);
assert.match(lib, /allCount/);

assert.match(ui, /loadBothBooksVatByMonth/);
assert.match(ui, /openBooksLines/);
assert.match(ui, /รายการจากสองบช/);
assert.match(ui, /vat-books-breakdown/);
assert.match(ui, /ExpandBtn/);
assert.match(ui, /vat-claim-check/);
assert.match(ui, /BooksVatEntryDetailModal/);
assert.match(ui, /toggleLineClaim/);
assert.match(ui, /toggleClaimAll/);
assert.match(ui, /ติ๊กหักภาษีซื้อทั้งหมด/);
assert.match(ui, /หักจากภาษีขาย/);
assert.match(ui, /ingredientVat:\s*nextVat/);
assert.match(ui, /sumClaimedBooksVat/);
assert.match(ui, /vat-books-line-btn/);
assert.match(ui, /vat-claim-line-mode/);
assert.match(ui, /applyClaimCostDelta/);

const detail = readFileSync(
  join(root, "src/components/vat-sales/BooksVatEntryDetailModal.tsx"),
  "utf8",
);
assert.match(detail, /vatClaim/);
assert.match(detail, /EntryVatFieldset/);
assert.match(detail, /getLedgerEntry|getOwnerBookEntry/);

console.log("OK test-vat-books-breakdown");
