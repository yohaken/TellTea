/**
 * Owner-books: per-entry VAT slot + trash in edit toolbar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libSrc = readFileSync(join(root, "src/lib/owner-books.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const vatSrc = readFileSync(
  join(root, "src/components/vat-sales/VatMonthBooks.tsx"),
  "utf8",
);

assert.match(libSrc, /hasVat/);
assert.match(libSrc, /vatInput/);
assert.match(libSrc, /vatInvoiceNo/);
assert.match(libSrc, /vatClaim/);
assert.match(libSrc, /proposeOwnerBookVatInput/);
assert.match(libSrc, /normalizeOwnerBookVat/);
assert.match(libSrc, /sumOwnerBooksVatInputByMonth/);
assert.match(libSrc, /getOwnerBookEntry/);

assert.match(pageSrc, /EntryVatFieldset/);
assert.match(pageSrc, /hasVat/);
assert.match(pageSrc, /vatInputStr/);
assert.match(pageSrc, /vatVerified/);
assert.match(pageSrc, /vatClaim/);
assert.match(pageSrc, /entry-toolbar-actions/);
assert.match(pageSrc, /className="trash-btn"/);
assert.match(pageSrc, /col-vat/);

assert.match(vatSrc, /loadBothBooksVatByMonth/);
assert.match(vatSrc, /ภาษีซื้อจากสองบช/);
assert.match(vatSrc, /syncBooksFromLedgers|รายการจากสองบช/);
assert.match(vatSrc, /BooksVatEntryDetailModal/);

const booksSrc = readFileSync(join(root, "src/lib/books-vat-month.ts"), "utf8");
assert.match(booksSrc, /loadBothBooksVatByMonth/);
assert.match(booksSrc, /sumBothBooksVatInputByMonth/);
assert.match(booksSrc, /listLedgerEntriesInMonth/);
assert.match(booksSrc, /listOwnerBookEntries/);
assert.match(booksSrc, /vatClaim/);

const ledgerPage = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
assert.match(ledgerPage, /EntryVatFieldset/);
assert.match(ledgerPage, /col-vat/);
assert.match(ledgerPage, /vatClaim/);

console.log("OK test-owner-books-vat-fields");
