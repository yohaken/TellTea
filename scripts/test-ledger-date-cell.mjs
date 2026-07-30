/**
 * Ledger/owner-books dense date column: stacked Bangkok day + sort on ingest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const cell = read("src/components/SheetDateCell.tsx");
const ledger = read("src/app/ledger/page.tsx");
const owner = read("src/app/owner-books/page.tsx");
const css = read("src/app/globals.css");
const utils = read("src/lib/utils.ts");
const version = read("src/lib/version.ts");

assert.match(cell, /date-stack-dm/);
assert.match(cell, /bangkokDateParts/);
assert.match(utils, /export function bangkokDateParts/);
assert.match(ledger, /SheetDateCell/);
assert.match(ledger, /sortByDateNewestFirst\(page\.entries\)/);
assert.match(ledger, /sortByDateNewestFirst\(cached\.entries\)/);
assert.match(owner, /SheetDateCell/);
assert.match(owner, /sortByDateNewestFirst\(page\.entries\)/);
assert.match(css, /\.date-stack\b/);
assert.match(css, /\.date-stack-dm\b/);
assert.doesNotMatch(
  css,
  /\.ledger-page \.ledger-staff-sheet \.sheet-table \.col-date \{\s*width: 2\.4rem;/,
);
assert.match(version, /APP_BUILD = 464/);

console.log("OK test-ledger-date-cell");
