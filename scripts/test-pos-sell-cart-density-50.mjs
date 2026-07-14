/**
 * POS 50 — fixed 5-col sell grid, no menu desc, taller cart list.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const css = read("src/app/globals.css");
const sell = read("src/components/PosSellView.tsx");
const ver = read("src/lib/pos-version.ts");

assert.match(ver, /POS_BUILD\s*=\s*50\b/);

assert.match(css, /--pos-nav-w:\s*11rem/);
assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css, /\.pos-sell-item-name[\s\S]*?font-size:\s*0\.92rem/);
assert.match(css, /\.pos-sell-item-price[\s\S]*?font-size:\s*0\.88rem/);
assert.match(css, /\.pos-cart-secondary-btn[\s\S]*?min-height:\s*2rem/);

assert.doesNotMatch(sell, /pos-sell-item-desc/);
assert.doesNotMatch(sell, /pos-cart-pay-alt/);
assert.doesNotMatch(sell, />\s*PromptPay\s*</);
assert.doesNotMatch(sell, />\s*เงินสด\s*</);

console.log("test-pos-sell-cart-density-50: ok");
