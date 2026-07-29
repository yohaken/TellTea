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
  join(root, "src/components/vat-sales/VatMonthlyWorkbench.tsx"),
  "utf8",
);

assert.match(lib, /loadBothBooksVatByMonth/);
assert.match(lib, /BooksVatLine/);
assert.match(lib, /bookLabel/);
assert.match(lib, /sumBothBooksVatInputByMonth/);

assert.match(ui, /loadBothBooksVatByMonth/);
assert.match(ui, /openBooksLines/);
assert.match(ui, /รายการจากสองบช/);
assert.match(ui, /vat-books-breakdown/);
assert.match(ui, /ExpandBtn/);

console.log("OK test-vat-books-breakdown");
