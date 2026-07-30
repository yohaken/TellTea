/**
 * PnL purchase VAT split from business cost — wiring + pure math.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pnl = readFileSync(join(root, "src/lib/pnl.ts"), "utf8");
const page = readFileSync(join(root, "src/app/pnl/page.tsx"), "utf8");
const xlsx = readFileSync(join(root, "src/lib/xlsx-export.ts"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(pnl, /vatCogs/);
assert.match(pnl, /purchaseVatTotal/);
assert.match(pnl, /addVatToAcc/);
assert.match(page, /ภาษีต้นทุน/);
assert.match(page, /ภาษีคชจ\./);
assert.match(page, /รวมภาษีซื้อ/);
assert.match(xlsx, /ภาษีซื้อ\(ต้นทุน\)/);
assert.match(version, /APP_BUILD = 500/);

function businessCostOut(amountOut, hasVat, vatInput) {
  const out = Number(amountOut) || 0;
  const vat = Number(vatInput) || 0;
  if (hasVat && vat > 0) return Math.max(0, out - vat);
  return out;
}

function accumulate(entries) {
  const acc = { cogs: 0, sga: 0, asset: 0, vatCogs: 0, vatSga: 0, vatAsset: 0 };
  for (const e of entries) {
    const cost = businessCostOut(e.amountOut, e.hasVat, e.vatInput);
    const vat = e.hasVat && e.vatInput > 0 ? e.vatInput : 0;
    if (e.type === "cogs") {
      acc.cogs += cost;
      acc.vatCogs += vat;
    } else if (e.type === "sga") {
      acc.sga += cost;
      acc.vatSga += vat;
    } else if (e.type === "asset") {
      acc.asset += cost;
      acc.vatAsset += vat;
    }
  }
  return acc;
}

const row = accumulate([
  { type: "cogs", amountOut: 107, hasVat: true, vatInput: 7 },
  { type: "sga", amountOut: 214, hasVat: true, vatInput: 14 },
  { type: "cogs", amountOut: 50, hasVat: false, vatInput: 0 },
]);
assert.equal(row.cogs, 150); // 100 + 50
assert.equal(row.vatCogs, 7);
assert.equal(row.sga, 200);
assert.equal(row.vatSga, 14);

console.log("OK test-pnl-purchase-vat-split");
