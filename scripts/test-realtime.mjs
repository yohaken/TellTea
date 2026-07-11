/**
 * Sanity: subscribeLedgerPage is exported and LEDGER_LIVE_MAX is sane.
 * Full listener needs Firebase — exercised on device after deploy.
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
assert.match(ledgerSrc, /LEDGER_LIVE_MAX\s*=\s*480/);
assert.match(pageSrc, /subscribeLedgerPage/);
assert.doesNotMatch(pageSrc, /void reload\(\)/);
assert.match(pageSrc, /scheduleBalance/);

console.log("OK realtime ledger wiring");
