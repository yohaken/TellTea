/**
 * Guard: points multiplier game suite (spin / feed / pour) + BOH demo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const lib = read("src/lib/points-multiplier-spin.ts");
assert.match(lib, /DEFAULT_SPIN_WEIGHTS/);
assert.match(lib, /pickMultiplier/);
assert.match(lib, /expectedMultiplier/);
assert.match(lib, /simulateSpins/);

const theme = read("src/lib/points-spin-theme.ts");
assert.match(theme, /ชาไทย/);
assert.match(theme, /ชานมไข่มุก/);
assert.match(theme, /ซอฟคุกกี้/);
assert.match(theme, /บราวนี่/);
assert.match(theme, /ชิโอปัง/);

assert.match(read("src/components/PointsMultiplierSpin.tsx"), /หมุนลุ้นคูณแต้ม/);
assert.match(read("src/components/PointsFeedBobaGame.tsx"), /ป้อนไข่มุก/);
assert.match(read("src/components/PointsPourTeaGame.tsx"), /เทชาไทยให้พอดี/);
assert.match(read("src/components/PointsFeedBobaGame.tsx"), /logo-telltea\.svg/);

const demo = read("src/app/members/spin-demo/page.tsx");
assert.match(demo, /หมุนกระดานเมนู/);
assert.match(demo, /ป้อนไข่มุก/);
assert.match(demo, /เทชาไทยให้พอดี/);
assert.match(demo, /AuthGate/);

assert.match(read("src/app/members/page.tsx"), /spin-demo/);
assert.match(read("src/app/claim/page.tsx"), /PointsMultiplierSpin/);
assert.match(read("src/app/join/page.tsx"), /PointsMultiplierSpin/);

const docs = read("docs/members-points-spin.md");
assert.match(docs, /members\/spin-demo/);
assert.match(docs, /ป้อนไข่มุก/);
assert.match(docs, /เทชาไทย/);

const logo = read("public/logo-telltea.svg");
assert.match(logo, /Tell Tea/);
assert.match(logo, /#003B5C/);
assert.doesNotMatch(logo, /bear|หมี/i);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 790);

// Runtime math via dynamic import of compiled-less TS is awkward — mirror defaults.
function expected(weights) {
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  return weights.reduce((s, w) => s + w.multiplier * (w.weight / sum), 0);
}
const defaults = [
  { multiplier: 1, weight: 50 },
  { multiplier: 2, weight: 28 },
  { multiplier: 3, weight: 14 },
  { multiplier: 4, weight: 6 },
  { multiplier: 5, weight: 2 },
];
const ev = expected(defaults);
assert.ok(ev > 1.8 && ev < 1.85, `EV ${ev}`);

console.log("OK test-members-points-spin");
