/**
 * AI receipt extract must not overwrite the ledger accounting date.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

assert.match(pageSrc, /extractOwnerBookFromReceipt/);
assert.doesNotMatch(pageSrc, /if \(result\.date\) setDate\(result\.date\)/);
assert.match(pageSrc, /Keep the accounting date|Keep the saved accounting date/);

assert.match(css, /ledger-staff-sheet/);
assert.match(css, /calc\(100% \+ 2rem\)/);
assert.match(css, /font-size: 0\.66rem/);

console.log("OK test-ledger-ai-keep-date");
