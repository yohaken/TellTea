/**
 * Ledger edit modal shows entry date + last-updated timestamp.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const metaSrc = readFileSync(join(root, "src/components/EntryTimestampsMeta.tsx"), "utf8");
const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");
const versionSrc = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(pageSrc, /EntryTimestampsMeta/);
assert.match(metaSrc, /วันที่รายการ/);
assert.match(metaSrc, /อัปเดต/);
assert.match(cssSrc, /\.entry-detail-meta\b/);
assert.match(versionSrc, /APP_BUILD\s*=\s*272/);

console.log("OK test-ledger-entry-timestamps");
