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
  join(root, "src/components/vat-sales/VatMonthlyWorkbench.tsx"),
  "utf8",
);

assert.match(libSrc, /hasVat/);
assert.match(libSrc, /vatInput/);
assert.match(libSrc, /vatInvoiceNo/);
assert.match(libSrc, /proposeOwnerBookVatInput/);
assert.match(libSrc, /normalizeOwnerBookVat/);
assert.match(libSrc, /sumOwnerBooksVatInputByMonth/);

assert.match(pageSrc, /EntryVatFieldset/);
assert.match(pageSrc, /hasVat/);
assert.match(pageSrc, /vatInputStr/);
assert.match(pageSrc, /vatVerified/);
assert.match(pageSrc, /entry-toolbar-actions/);
assert.match(pageSrc, /className="trash-btn"/);
assert.match(pageSrc, /col-vat/);

assert.match(vatSrc, /sumBothBooksVatInputByMonth/);
assert.match(vatSrc, /ดึงภาษีซื้อจากสองบช/);

const booksSrc = readFileSync(join(root, "src/lib/books-vat-month.ts"), "utf8");
assert.match(booksSrc, /sumBothBooksVatInputByMonth/);
assert.match(booksSrc, /sumLedgerVatInputByMonth/);
assert.match(booksSrc, /sumOwnerBooksVatInputByMonth/);

const ledgerPage = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
assert.match(ledgerPage, /EntryVatFieldset/);
assert.match(ledgerPage, /col-vat/);

console.log("OK test-owner-books-vat-fields");
