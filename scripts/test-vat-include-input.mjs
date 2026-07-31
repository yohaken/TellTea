/**
 * Month books: toggle includeInputVat — output always, input optional in net.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const books = readFileSync(join(root, "src/lib/vat-month-books.ts"), "utf8");
assert.match(books, /includeInputVat/);
assert.match(books, /inputVatApplied/);
assert.match(books, /includeInputVat \? inputVat : 0/);

const monthly = readFileSync(join(root, "src/lib/vat-monthly.ts"), "utf8");
assert.match(monthly, /includeInputVat/);
assert.match(monthly, /includeInputVat !== false/);

const ui = readFileSync(
  join(root, "src/components/vat-sales/VatMonthBooks.tsx"),
  "utf8",
);
assert.match(ui, /vat-include-input-toggle/);
assert.match(ui, /นำภาษีซื้อมารวมหักจากภาษีขาย/);
assert.match(ui, /ภาษีขายคำนวณเสมอ/);
assert.match(ui, /view\.inputVatApplied/);
assert.match(ui, /ยังไม่หัก/);

const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");
assert.match(version, /APP_BUILD = 512/);

console.log("OK test-vat-include-input");
