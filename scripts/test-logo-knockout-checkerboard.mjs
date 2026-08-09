/**
 * Transparency-grid greys must be knocked out (baked checkerboard PNGs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/receipts.ts"), "utf8");
assert.match(src, /Transparency-grid|checkerboard|ตารางหมากรุก/);
assert.match(src, /avg >= 155/);
assert.match(src, /chroma <= 22/);
assert.match(src, /8-connected/);
assert.match(src, /tryPush\(x \+ 1, y \+ 1\)/);

// Pure RGB rules — mirror isLogoKnockoutRgb without DOM.
function isLogoKnockoutRgb(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  const chroma = max - min;
  if (avg >= 205 && chroma <= 60) return true;
  if (avg >= 155 && avg <= 245 && chroma <= 22) return true;
  return false;
}

assert.equal(isLogoKnockoutRgb(255, 255, 255), true); // white
assert.equal(isLogoKnockoutRgb(204, 204, 204), true); // #ccc grid
assert.equal(isLogoKnockoutRgb(192, 192, 192), true); // #c0c0c0
assert.equal(isLogoKnockoutRgb(232, 232, 232), true);
assert.equal(isLogoKnockoutRgb(20, 40, 90), false); // navy Tell Tea
assert.equal(isLogoKnockoutRgb(0, 128, 80), false); // green mark
assert.equal(isLogoKnockoutRgb(30, 30, 30), false); // near-black ink

console.log("OK test-logo-knockout-checkerboard");
