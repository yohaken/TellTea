/**
 * POS 49 — narrower nav (~30%), denser sell cards (superseded checks kept soft).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const css = read("src/app/globals.css");
const ver = read("src/lib/pos-version.ts");

assert.match(ver, /POS_BUILD\s*=\s*\d+/);
assert.match(css, /--pos-nav-w:\s*11rem/);
assert.match(css, /\.pos-sidebar-link[\s\S]*?font-size:\s*0\.78rem/);
assert.match(css, /container-type:\s*size/);
assert.match(css, /aspect-ratio:\s*16\s*\/\s*10/);
assert.match(css, /100cqh\s*\/\s*5/);
assert.doesNotMatch(css, /\.pos-sell-item-caption[\s\S]{0,200}line-clamp:\s*2/);

console.log("test-pos-sell-density-nav: ok");
