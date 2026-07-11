/**
 * Sanity: live ledger + balance wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerSrc = readFileSync(join(root, "src/lib/ledger.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");

assert.match(ledgerSrc, /export function subscribeLedgerPage/);
assert.match(ledgerSrc, /onSnapshot/);
assert.match(ledgerSrc, /subscribeLedgerBalance/);
assert.match(pageSrc, /subscribeLedgerPage/);
assert.match(pageSrc, /subscribeLedgerBalance/);
assert.doesNotMatch(pageSrc, /void reload\(\)/);

console.log("OK realtime ledger wiring");
