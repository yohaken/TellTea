/**
 * Ledger: no on-page Excel export; photo clarity tip for staff; export stays in More.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const more = readFileSync(join(root, "src/app/more/page.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

assert.doesNotMatch(ledger, /exportLedgerXlsx/);
assert.doesNotMatch(ledger, /ส่งออกตาราง Excel/);
assert.doesNotMatch(ledger, /onExportTables/);
assert.match(ledger, /ledger-photo-tip/);
assert.match(ledger, /ถ่ายหลักฐานให้คมชัด/);
assert.match(ledger, /เอกสารซื้อ/);
assert.match(css, /\.ledger-photo-tip\b/);
assert.match(more, /href: "\/export\/"/);
assert.match(more, /perm: "exportData"/);

console.log("OK test-ledger-photo-tip-no-export");
