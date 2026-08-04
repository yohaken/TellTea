/**
 * Ledger: no on-page Excel export; photo tip lives inside create-entry form.
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
// Tip must NOT sit in the main daily list chrome
assert.doesNotMatch(
  ledger.split("function AddOutModal")[0] || "",
  /ledger-photo-tip/,
);
// Tip stays inside create-entry (AddOutModal)
assert.match(ledger, /ledger-photo-tip is-in-form/);
assert.match(ledger, /ถ่ายหลักฐานให้คมชัดก่อนแนบ/);
assert.match(css, /\.ledger-photo-tip\b/);
assert.match(css, /\.ledger-photo-tip\.is-in-form/);
assert.match(more, /href: "\/export\/"/);
assert.match(more, /perm: "exportData"/);
assert.match(more, /ส่งออกข้อมูล/);

console.log("OK test-ledger-photo-tip-no-export");
