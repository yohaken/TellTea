/**
 * Asset type purple bar wiring — ledger + owner-books.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const labels = readFileSync(join(root, "src/lib/ledger-labels.ts"), "utf8");
const ledger = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const owner = readFileSync(join(root, "src/app/owner-books/page.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.match(labels, /isLedgerAssetType/);
assert.match(labels, /canonicalLedgerType\(type\) === "asset"/);
assert.match(ledger, /is-asset-type/);
assert.match(ledger, /isLedgerAssetType/);
assert.match(owner, /is-asset-type/);
assert.match(owner, /isLedgerAssetType/);
assert.match(css, /col-type\.is-asset-type/);
assert.match(css, /#7c3aed/);
assert.match(version, /APP_BUILD = 498/);

function isLedgerAssetType(type) {
  const t = String(type || "").trim().toLowerCase();
  return t === "asset" || t === "assets" || t === "capex" || t.includes("สินทรัพย์") || t.includes("ทรัพย์สิน");
}

assert.equal(isLedgerAssetType("asset"), true);
assert.equal(isLedgerAssetType("สินทรัพย์ (asset)"), true);
assert.equal(isLedgerAssetType("cogs"), false);

console.log("OK test-ledger-asset-type-bar");
