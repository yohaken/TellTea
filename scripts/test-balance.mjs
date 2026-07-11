/**
 * Guardrails for balance + zoom removal.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerSrc = readFileSync(join(root, "src/lib/ledger.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const cssSrc = readFileSync(join(root, "src/app/globals.css"), "utf8");
const rulesSrc = readFileSync(join(root, "firestore.rules"), "utf8");

assert.match(ledgerSrc, /subscribeLedgerBalance/);
assert.match(ledgerSrc, /recomputeLedgerBalance/);
assert.match(ledgerSrc, /meta", "ledger"/);
assert.match(ledgerSrc, /applyBalanceDelta/);
assert.match(pageSrc, /subscribeLedgerBalance/);
assert.doesNotMatch(pageSrc, /sheet-zoom|changeZoom|ขนาดตาราง/);
assert.match(cssSrc, /\.balance-bar/);
assert.doesNotMatch(cssSrc, /\.balance-hero|\.zoom-controls|--sheet-zoom/);
assert.match(rulesSrc, /match \/meta\/\{docId\}/);

console.log("OK balance bar + meta ledger + no zoom");
