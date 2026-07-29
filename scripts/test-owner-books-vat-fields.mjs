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

assert.match(pageSrc, /ช่อง VAT/);
assert.match(pageSrc, /hasVat/);
assert.match(pageSrc, /vatInputStr/);
assert.match(pageSrc, /entry-toolbar-actions/);
assert.match(pageSrc, /className="trash-btn"/);
assert.match(pageSrc, /col-vat/);
assert.match(pageSrc, /owner-vat-box/);

assert.match(vatSrc, /sumOwnerBooksVatInputByMonth/);
assert.match(vatSrc, /ดึงภาษีซื้อจากบช\.เจ้าของ/);

console.log("OK test-owner-books-vat-fields");
