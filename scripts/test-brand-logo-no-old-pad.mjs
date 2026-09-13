/**
 * Regression lock: the old "boxed / wrong" logo must not return.
 *
 * Guards:
 * 1) Login can read meta/brandLogo without Auth
 * 2) Knockout v3 stays wired (re-punch stored PNGs)
 * 3) Hero turns mark white on green (no dark/light pad box)
 * 4) AppBrand waits for resolve (no stock SVG flash when custom exists)
 * 5) Live-shaped navy mark on white pad → corners transparent after knockout
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const rules = read("firestore.rules");
assert.match(rules, /docId == 'brandLogo'/);
assert.match(rules, /Login needs brand mark before Auth/);
assert.doesNotMatch(
  rules,
  /match \/meta\/\{docId\}[\s\S]*allow get: if signedIn\(\);/,
  "brandLogo get must not require Auth-only",
);

const brand = read("src/lib/brand-logo.ts");
assert.match(brand, /BRAND_LOGO_KNOCKOUT_VERSION = 3/);
assert.match(brand, /storedKnockoutVer < BRAND_LOGO_KNOCKOUT_VERSION/);
assert.match(brand, /prepareAndShrinkLogo\(src, true\)/);

const receipts = read("src/lib/receipts.ts");
assert.match(receipts, /Soft fringe \(v3\)/);
assert.match(receipts, /Near-black baked plate/);
assert.match(receipts, /forceKnockout/);

const css = read("src/app/globals.css");
assert.match(css, /\.hero-brand \.brand-logo-custom[\s\S]*?brightness\(0\) invert\(1\)/);
assert.match(css, /\.brand-wrap-compact \.brand-logo-custom\.brand-logo-compact/);
assert.doesNotMatch(css, /brand-logo-dark-pad/);

const appBrand = read("src/components/AppBrand.tsx");
assert.match(appBrand, /logoResolved/);
assert.match(appBrand, /brand-logo-slot/);
assert.match(appBrand, /useCustom \?/);
// Stock SVG only after resolve AND no custom — never as optimistic default
assert.match(appBrand, /logoResolved \? \([\s\S]*logo-telltea\.svg/);

// Pixel proof: white plate + navy glyph → corners clear, ink stays
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

function knockOut(data, w, h) {
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    if (data[o + 3] < 12) continue;
    if (!isLogoKnockoutRgb(data[o], data[o + 1], data[o + 2])) continue;
    data[o + 3] = 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (data[o + 3] < 12) continue;
      const avg = (data[o] + data[o + 1] + data[o + 2]) / 3;
      const chroma =
        Math.max(data[o], data[o + 1], data[o + 2]) -
        Math.min(data[o], data[o + 1], data[o + 2]);
      if (avg < 120 || chroma > 55) continue;
      let touches = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (!touches) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          if (data[((y + dy) * w + (x + dx)) * 4 + 3] < 12) {
            touches = true;
            break;
          }
        }
      }
      if (touches) data[o + 3] = 0;
    }
  }
}

const W = 48;
const H = 48;
const data = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  data[o] = 245;
  data[o + 1] = 246;
  data[o + 2] = 239; // cream pad like login complaint
  data[o + 3] = 255;
}
for (let y = 12; y < 36; y++) {
  for (let x = 12; x < 36; x++) {
    const o = (y * W + x) * 4;
    data[o] = 8;
    data[o + 1] = 62;
    data[o + 2] = 93;
    data[o + 3] = 255;
  }
}
knockOut(data, W, H);
assert.equal(data[3], 0, "cream corner must be transparent");
assert.equal(data[((W - 1) * W + (W - 1)) * 4 + 3], 0);
assert.equal(data[(24 * W + 24) * 4 + 3], 255, "navy ink stays");
assert.equal(data[(24 * W + 24) * 4], 8);

console.log("OK test-brand-logo-no-old-pad");
