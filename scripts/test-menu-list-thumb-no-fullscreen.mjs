/**
 * Regression: BOH menu list thumbs must not use fullscreen absolute lazy-image.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/version.ts"), /APP_BUILD = 266/);

const css = read("src/app/globals.css");
const admin = read("src/components/PosMenuAdmin.tsx");
const lazy = read("src/components/PosLazyMenuImage.tsx");

// Lazy image used in admin list
assert.match(admin, /PosLazyMenuImage/);
assert.match(admin, /pos-menu-item-thumb/);
assert.match(admin, /setScreen\(\{ kind: "edit-item"/);
assert.match(admin, /item\.name/);

// Default lazy wrapper is relative — NOT absolute fullscreen
assert.match(css, /\.pos-lazy-menu-image \{\s*position: relative;/);
assert.match(css, /Bug: absolute\+inset:0 without positioned parent/);

// Absolute fill only scoped to sell/picker frames
assert.match(css, /\.pos-sell-item-media \.pos-lazy-menu-image/);
assert.match(css, /\.pos-option-picker-thumb \.pos-lazy-menu-image \{\s*position: absolute;/);

// List thumb box constrained
assert.match(css, /\.pos-menu-item-row > \.pos-lazy-menu-image \{[\s\S]*?width: 2\.25rem/);
assert.match(css, /รูปเต็มจอทับรายชื่อเมนู/);

assert.match(lazy, /pos-lazy-menu-image/);

console.log("ok: menu-list-thumb-no-fullscreen");
