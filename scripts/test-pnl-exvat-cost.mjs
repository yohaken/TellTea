/**
 * PnL uses businessCostOut (ex-VAT only when vatClaim) + purchase VAT columns.
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
assert.match(entryVat, /vatClaim && vat > 0/);
assert.match(
  pnl,
  /businessCostOut\(\s*entry\.amountOut,\s*entry\.hasVat,\s*entry\.vatInput,\s*entry\.vatClaim,\s*\)/,
);
assert.match(pnl, /entry\.vatClaim/);
assert.match(pnl, /vatCogs/);
assert.match(pnl, /purchaseVatTotal/);
assert.match(fieldset, /VatClaimModeToggle/);
assert.match(fieldset, /ซื้อไปเหอะ/);
assert.match(pnlPage, /ภาษีต้นทุน/);
assert.match(pnlPage, /รวมภาษีซื้อ/);
assert.match(version, /APP_BUILD = 509/);
assert.match(fieldset, /จะเอาภาษีซื้อไปหัก VAT เดือนไหม/);

console.log("OK test-pnl-exvat-cost");
