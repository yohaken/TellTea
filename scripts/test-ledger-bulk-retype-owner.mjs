/**
 * Ledger staff table: bulk checkbox column removed (space for wider rows).
 * Lib helper may remain for scripts; UI no longer exposes multi-select.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libSrc = readFileSync(join(root, "src/lib/ledger.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(libSrc, /export async function bulkUpdateLedgerTypes/);

assert.doesNotMatch(pageSrc, /bulk-check-col/);
assert.doesNotMatch(pageSrc, /selectedIds/);
assert.doesNotMatch(pageSrc, /onBulkRetype/);
assert.doesNotMatch(pageSrc, /BULK_TYPE_OPTIONS/);
assert.doesNotMatch(pageSrc, /ledger-bulk-compact/);
assert.doesNotMatch(pageSrc, /bulkUpdateLedgerTypes/);

assert.match(pageSrc, /ledger-table-search/);
assert.match(pageSrc, /ledger-staff-sheet/);
assert.match(versionSrc, /APP_BUILD\s*=\s*457/);

console.log("OK test-ledger-bulk-retype-owner");
