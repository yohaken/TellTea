/**
 * Ledger (staff books): owner-only multi-select + bulk retype.
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
assert.match(libSrc, /typeSource:\s*"owner"/);
assert.match(libSrc, /collection\(getDb\(\),\s*"ledger"\)|doc\(db,\s*"ledger"/);

assert.match(pageSrc, /bulkUpdateLedgerTypes/);
assert.match(pageSrc, /selectedIds/);
assert.match(pageSrc, /onBulkRetype/);
assert.match(pageSrc, /BULK_TYPE_OPTIONS/);
assert.match(pageSrc, /isOwner && selectedIds\.size > 0/);
assert.match(pageSrc, /ledger-bulk-compact/);
assert.match(pageSrc, /\{isOwner \? \(/);
assert.match(pageSrc, /bulk-check-col/);
assert.doesNotMatch(pageSrc, /เลือกที่แสดง/);
assert.doesNotMatch(pageSrc, /ติ๊กเลือกด้านหน้าหลายแถว/);
assert.match(pageSrc, /if \(!isOwner\) return;/);
assert.match(pageSrc, /ledger-table-search/);

assert.match(versionSrc, /APP_BUILD\s*=\s*387/);

console.log("OK test-ledger-bulk-retype-owner");
