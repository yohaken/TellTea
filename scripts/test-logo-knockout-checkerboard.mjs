/**
 * Transparency-grid greys must be knocked out (baked checkerboard PNGs).
 * Also guards v3 dark-plate + soft fringe thresholds.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/receipts.ts"), "utf8");
assert.match(src, /Transparency-grid|checkerboard|ตารางหมากรุก/);
assert.match(src, /avg >= 145/);
assert.match(src, /chroma <= 32/);
assert.match(src, /avg >= 185/);
assert.match(src, /avg <= 22/);
assert.match(src, /8-connected/);
assert.match(src, /tryPush\(x \+ 1, y \+ 1\)/);
assert.match(src, /Enclosed holes|enclosed/);
assert.match(src, /Soft fringe \(v3\)/);

const brand = readFileSync(join(root, "src/lib/brand-logo.ts"), "utf8");
assert.match(brand, /BRAND_LOGO_KNOCKOUT_VERSION = 3/);

// Pure RGB rules — mirror isLogoKnockoutRgb without DOM.
function isLogoKnockoutRgb(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const avg = (r + g + b) / 3;
  const chroma = max - min;
  if (avg <= 22 && chroma <= 18) return true;
  if (avg >= 185 && chroma <= 60) return true;
  if (avg >= 145 && avg <= 245 && chroma <= 32) return true;
  return false;
}

assert.equal(isLogoKnockoutRgb(255, 255, 255), true); // white
assert.equal(isLogoKnockoutRgb(204, 204, 204), true); // #ccc grid
assert.equal(isLogoKnockoutRgb(192, 192, 192), true); // #c0c0c0
assert.equal(isLogoKnockoutRgb(232, 232, 232), true);
assert.equal(isLogoKnockoutRgb(190, 195, 185), true); // soft cream fringe
assert.equal(isLogoKnockoutRgb(0, 0, 0), true); // baked black plate
assert.equal(isLogoKnockoutRgb(10, 10, 10), true);
assert.equal(isLogoKnockoutRgb(20, 40, 90), false); // navy Tell Tea
assert.equal(isLogoKnockoutRgb(8, 62, 93), false); // live brand ink
assert.equal(isLogoKnockoutRgb(0, 128, 80), false); // green mark
assert.equal(isLogoKnockoutRgb(30, 30, 30), false); // near-black ink (not plate)

console.log("OK test-logo-knockout-checkerboard");
