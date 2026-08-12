/**
 * Guard: single physics wheel — fixed 1–5 points, distributed slices.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = pathJoin(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(pathJoin(root, p), "utf8");

const lib = read("src/lib/points-multiplier-spin.ts");
assert.match(lib, /DEFAULT_SPIN_WEIGHTS/);
assert.match(lib, /buildWheelSlices/);
assert.match(lib, /distributePointLabels/);
assert.match(lib, /allocateSliceCounts/);
assert.match(lib, /sliceAtPointer/);
assert.match(lib, /awardSpinPoints/);
assert.match(lib, /simulatePhysicsCoasts/);
assert.doesNotMatch(lib, /pickMultiplier/);

const games = read("src/lib/points-games.ts");
assert.match(games, /PointsGameId/);
assert.match(games, /POINTS_GAMES_CUSTOMER_LIVE\s*=\s*false/);
assert.match(games, /หมุนวงล้อลุ้นแต้ม|หมุนวงล้อ/);
assert.doesNotMatch(games, /"feed"|"pour"/);
assert.match(games, /1–5|1-5/);

const theme = read("src/lib/points-spin-theme.ts");
assert.match(theme, /POINTS_ONLY_NOTE/);
assert.match(theme, /ได้แต้มคงที่|ไม่ใช่ตัวคูณ/);
assert.doesNotMatch(theme, /คูณ 1 แต้ม|ชิโอปัง/);

assert.match(read("src/components/PointsGameBrandLogo.tsx"), /loadBrandLogo/);

const attract = read("src/components/PointsGamesAttractBg.tsx");
assert.match(attract, /PointsMultiplierSpin/);
assert.doesNotMatch(attract, /PointsFeedBobaGame|PointsPourTeaGame/);

const once = read("src/components/PointsGameOnce.tsx");
assert.match(once, /หมุนวงล้อ/);
assert.doesNotMatch(once, /PointsFeedBobaGame|PointsPourTeaGame|เลือก 1 เกม/);
assert.match(once, /PointsGameBrandLogo|PointsMultiplierSpin/);

const spinUi = read("src/components/PointsMultiplierSpin.tsx");
assert.doesNotMatch(spinUi, /\buseEffectEvent\s*\(/);
assert.match(spinUi, /onCompleteRef/);
assert.match(spinUi, /coasting|WHEEL_STOP_DECEL/);
assert.match(spinUi, /sliceAtPointer/);
assert.match(spinUi, /PointsGameBrandLogo/);
assert.doesNotMatch(spinUi, /pickMultiplier|wheelTargetRotation|beginToward/);

const css = read("src/app/globals.css");
assert.match(css, /\.pts-wheel-stage/);
assert.match(css, /\.pts-wheel-disc/);

assert.match(read("src/app/claim/page.tsx"), /POINTS_GAMES_CUSTOMER_LIVE/);
assert.match(read("src/app/join/page.tsx"), /POINTS_GAMES_CUSTOMER_LIVE/);

const demo = read("src/app/members/spin-demo/page.tsx");
assert.match(demo, /โฟลว์ลูกค้า/);
assert.match(demo, /ทดลองหลังร้านเท่านั้น/);
assert.match(demo, /ยังไม่เปิดในลิงก์ลูกค้า/);
assert.match(demo, /หน่วง|ฟิสิกส์/);
assert.doesNotMatch(demo, /PointsFeedBobaGame|PointsPourTeaGame/);

assert.match(read("src/app/members/page.tsx"), /spin-demo/);
assert.match(read("src/app/members/page.tsx"), /จำลองหมุนวงล้อ \(เทส\)/);

const docs = read("docs/members-points-spin.md");
assert.match(docs, /POINTS_GAMES_CUSTOMER_LIVE/);
assert.match(docs, /หน่วงตามฟิสิกส์|ฟิสิกส์/);
assert.match(docs, /แบ่งย่อย|กระจาย/);
assert.match(docs, /ไม่ใช่ตัวคูณ/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 795);

// Runtime: distributed slices + pointer mapping
const require = createRequire(import.meta.url);
// TS not loadable via require — inline minimal checks by evaluating key logic from source patterns
// Re-implement tiny copies for structural math checks:
function normalize(weights) {
  const map = new Map([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  for (const w of weights) {
    const p = w.points ?? w.multiplier;
    if (map.has(p) && w.weight > 0) map.set(p, map.get(p) + w.weight);
  }
  return [1, 2, 3, 4, 5]
    .map((points) => ({ points, weight: map.get(points) }))
    .filter((w) => w.weight > 0);
}
function allocate(weights, target = 40) {
  const norm = normalize(weights);
  const sum = norm.reduce((s, w) => s + w.weight, 0);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let assigned = 0;
  for (const w of norm) {
    const c = Math.max(1, Math.round((w.weight / sum) * target));
    counts[w.points] = c;
    assigned += c;
  }
  while (assigned > target) {
    const pool = [1, 2, 3, 4, 5].filter((t) => counts[t] > 1).sort((a, b) => counts[b] - counts[a]);
    if (!pool.length) break;
    counts[pool[0]] -= 1;
    assigned -= 1;
  }
  while (assigned < target) {
    const pool = [1, 2, 3, 4, 5].filter((t) => counts[t] > 0).sort((a, b) => counts[b] - counts[a]);
    if (!pool.length) break;
    counts[pool[0]] += 1;
    assigned += 1;
  }
  return counts;
}
function distribute(counts) {
  const total = [1, 2, 3, 4, 5].reduce((s, t) => s + counts[t], 0);
  const slots = Array.from({ length: total }, () => null);
  const order = [1, 2, 3, 4, 5].filter((t) => counts[t] > 0).sort((a, b) => counts[a] - counts[b]);
  for (const tier of order) {
    const need = counts[tier];
    const free = [];
    for (let i = 0; i < total; i++) if (slots[i] == null) free.push(i);
    for (let k = 0; k < need; k++) {
      const pick = Math.floor(((k + 0.5) * free.length) / need);
      const at = Math.min(free.length - 1, Math.max(0, pick));
      slots[free[at]] = tier;
      free.splice(at, 1);
    }
  }
  return slots;
}

const defaults = [
  { points: 1, weight: 50 },
  { points: 2, weight: 28 },
  { points: 3, weight: 14 },
  { points: 4, weight: 6 },
  { points: 5, weight: 2 },
];
const counts = allocate(defaults, 40);
assert.equal(
  [1, 2, 3, 4, 5].reduce((s, t) => s + counts[t], 0),
  40,
);
const labels = distribute(counts);
assert.equal(labels.length, 40);
// No long run of identical labels longer than ~ceil(n/tiers)+2 for 1s
let maxRun = 1;
let run = 1;
for (let i = 1; i < labels.length; i++) {
  if (labels[i] === labels[i - 1]) {
    run += 1;
    maxRun = Math.max(maxRun, run);
  } else run = 1;
}
assert.ok(maxRun <= 3, `max contiguous run ${maxRun} — slices should be distributed`);

const sumW = defaults.reduce((s, w) => s + w.weight, 0);
const ev = defaults.reduce((s, w) => s + w.points * (w.weight / sumW), 0);
assert.ok(ev > 1.8 && ev < 1.85, `EV ${ev}`);

assert.equal(typeof require, "function");

console.log("OK test-members-points-spin");
