import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const sell = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sell, /pos-sell-item-caption/);
assert.match(sell, /pos-sell-item-name/);
assert.match(sell, /is-sparse/);
assert.match(sell, /is-mid/);
assert.match(sell, /visibleItems\.length <= 9/);
assert.doesNotMatch(sell, /is-dense/);
assert.doesNotMatch(sell, /visibleItems\.length >= 21/);
assert.doesNotMatch(sell, /pos-sell-item-desc/);

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.pos-sell-item-caption/);
assert.match(css, /aspect-ratio:\s*16\s*\/\s*10/);
assert.match(css, /align-items:\s*start/);
assert.match(css, /grid-template-columns:\s*repeat\(5,/);
assert.match(css, /overflow:\s*visible/);
assert.doesNotMatch(
  css,
  /\.pos-sell-grid\.is-dense \{\s*grid-template-columns:\s*repeat\(4,/,
);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = \d+/);

console.log("OK pos-menu-item-labels");
