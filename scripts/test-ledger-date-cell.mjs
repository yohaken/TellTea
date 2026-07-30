/**
 * Ledger date cell: single line d/m/yy, normal color (no year stack).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const cell = read("src/components/SheetDateCell.tsx");
const css = read("src/app/globals.css");
const version = read("src/lib/version.ts");

assert.match(cell, /formatDateShort/);
assert.match(cell, /sheet-date-cell/);
assert.doesNotMatch(cell, /date-stack/);
assert.match(css, /\.sheet-date-cell\b/);
assert.doesNotMatch(css, /\.date-stack-yy\b/);
assert.match(css, /width: 3\.4rem/);
assert.match(version, /APP_BUILD = 465/);

console.log("OK test-ledger-date-cell");
