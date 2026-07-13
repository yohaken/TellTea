import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const sell = readFileSync(join(root, "src/components/PosSellView.tsx"), "utf8");
assert.match(sell, /pos-sell-item-caption/);
assert.match(sell, /pos-sell-item-name/);
assert.match(sell, /is-sparse/);
assert.match(sell, /is-dense/);
assert.match(sell, /is-mid/);
assert.match(sell, /visibleItems\.length >= 21/);
assert.match(sell, /visibleItems\.length <= 8/);

const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.pos-sell-item-caption/);
assert.match(css, /min-height:\s*2\.85rem/);
assert.match(css, /\.pos-sell-grid\.is-sparse/);
assert.match(css, /\.pos-sell-grid\.is-dense/);
assert.match(css, /grid-template-columns:\s*repeat\(4,/);
assert.doesNotMatch(
  css,
  /\.pos-sell-grid \{\s*grid-template-columns:\s*repeat\(5,/,
);

const version = readFileSync(join(root, "src/lib/pos-version.ts"), "utf8");
assert.match(version, /POS_BUILD = 42/);

console.log("OK pos-menu-item-labels");
