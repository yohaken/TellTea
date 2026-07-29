import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  looksLikeShopeeTaxInvoice,
  parseShopeeInvoiceFromFileName,
  parseShopeeTaxInvoice,
  shopeeTaxInvoiceToImportRow,
} from "../src/lib/vat-import-shopee-taxinvoice";

const name = "TRSPESPF00-00000-260715-016860.pdf";
const fromName = parseShopeeInvoiceFromFileName(name);
assert.equal(fromName.dateKey, "2026-07-15");
assert.equal(fromName.invoiceNo, "TRSPESPF00-00000-260715-016860");

const fixture = readFileSync(
  join(__dirname, "../testdata/vat-import/shopee-taxinvoice-260715.txt"),
  "utf8",
);
assert.equal(looksLikeShopeeTaxInvoice(fixture), true);

const parsed = parseShopeeTaxInvoice(fixture, name);
assert.equal(parsed.dateKey, "2026-07-15");
assert.equal(parsed.monthKey, "2026-07");
assert.equal(parsed.feeExVat, 753.5);
assert.equal(parsed.gpVat, 52.75);
assert.equal(parsed.feeInclVat, 806.25);
assert.ok(parsed.invoiceNo.includes("260715"));

const row = shopeeTaxInvoiceToImportRow(parsed, { fileName: name });
assert.ok(row);
assert.equal(row.channel, "shopee");
assert.equal(row.rowKind, "tax_invoice");
assert.equal(row.gpVat, 52.75);
assert.equal(row.grossInclusive, 0);

console.log("test-vat-import-shopee-taxinvoice: ok");
