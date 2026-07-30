/**
 * PnL uses businessCostOut (ex-VAT) + purchase VAT columns wiring check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const entryVat = readFileSync(join(root, "src/lib/entry-vat.ts"), "utf8");
const pnl = readFileSync(join(root, "src/lib/pnl.ts"), "utf8");
const fieldset = readFileSync(join(root, "src/components/EntryVatFieldset.tsx"), "utf8");
const pnlPage = readFileSync(join(root, "src/app/pnl/page.tsx"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(entryVat, /export function businessCostOut/);
assert.match(pnl, /businessCostOut\(entry\.amountOut, entry\.hasVat, entry\.vatInput\)/);
assert.match(pnl, /vatCogs/);
assert.match(pnl, /purchaseVatTotal/);
assert.match(fieldset, /ต้นทุนบัญชี/);
assert.match(pnlPage, /ภาษีต้นทุน/);
assert.match(pnlPage, /รวมภาษีซื้อ/);
assert.match(version, /APP_BUILD = 501/);

console.log("OK test-pnl-exvat-cost");
