/**
 * Guard: skill-aimable wheel + owner live toggle + server credit wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

const root = pathJoin(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(pathJoin(root, p), "utf8");

const lib = read("src/lib/points-multiplier-spin.ts");
assert.match(lib, /DEFAULT_SPIN_WEIGHTS/);
assert.match(lib, /DEFAULT_WHEEL_SLICE_COUNT\s*=\s*12/);
assert.match(lib, /WHEEL_SLICE_COUNT_MIN\s*=\s*8/);
assert.match(lib, /WHEEL_SLICE_COUNT_MAX\s*=\s*24/);
assert.match(lib, /buildWheelSlices/);
assert.match(lib, /distributePointLabels/);
assert.match(lib, /clampWheelSliceCount/);
assert.match(lib, /sliceAtPointer/);
assert.match(lib, /awardSpinPoints/);
assert.doesNotMatch(lib, /pickMultiplier/);

const settings = read("src/lib/points-spin-settings.ts");
assert.match(settings, /pointsSpinSettings/);
assert.match(settings, /loadPointsSpinSettings/);
assert.match(settings, /savePointsSpinSettings/);
assert.match(settings, /subscribePointsSpinSettings/);
assert.match(settings, /gamesEnabled/);
assert.match(settings, /isPointsGameEnabled/);
assert.match(settings, /sliceCount/);

const rules = read("firestore.rules");
assert.match(rules, /pointsSpinSettings/);
assert.match(rules, /memberSpinPlays/);

const games = read("src/lib/points-games.ts");
assert.match(games, /POINTS_GAMES_KILL_SWITCH\s*=\s*false/);
assert.doesNotMatch(games, /"feed"|"pour"/);

const credit = read("src/lib/points-spin-credit.ts");
assert.match(credit, /publicSpinGameCredit/);
assert.match(credit, /creditSpinGamePoints/);

assert.match(read("src/components/PointsGamesAttractBg.tsx"), /subscribePointsSpinSettings|liveSettings/);
assert.match(read("src/components/PointsGameOnce.tsx"), /sliceCount|subscribePointsSpinSettings|liveSettings/);

const spinUi = read("src/components/PointsMultiplierSpin.tsx");
assert.doesNotMatch(spinUi, /\buseEffectEvent\s*\(/);
assert.match(spinUi, /sliceCount/);
assert.match(spinUi, /spinSpeed/);
assert.match(spinUi, /stopDecel/);
assert.match(spinUi, /กะจังหวะ|ช่องใหญ่/);
assert.doesNotMatch(spinUi, /pickMultiplier|beginToward/);

const demo = read("src/app/members/spin-demo/page.tsx");
assert.match(demo, /บันทึกค่าตั้งวงล้อ/);
assert.match(demo, /จำนวนช่อง/);
assert.match(demo, /SLICE_COUNT_MIN|sliceCount/);
assert.match(demo, /savePointsSpinSettings/);
assert.match(demo, /gamesEnabled|spinEnabled/);
assert.match(demo, /เปิดเกม/);
assert.match(demo, /กะจังหวะ/);

const join = read("src/app/join/page.tsx");
assert.match(join, /isPointsGameEnabled|subscribePointsSpinSettings/);
assert.match(join, /creditSpinGamePoints/);
assert.match(join, /spinPlayToken/);

const claim = read("src/app/claim/page.tsx");
assert.match(claim, /isPointsGameEnabled|subscribePointsSpinSettings/);
assert.match(claim, /creditSpinGamePoints/);

const membersPage = read("src/app/members/page.tsx");
assert.match(membersPage, /lifetimeGameBonusPoints/);
assert.match(membersPage, /แต้มเกม/);

const membersLib = read("src/lib/members.ts");
assert.match(membersLib, /lifetimeGameBonusPoints/);
assert.match(membersLib, /earn_spin_game/);

const cf = read("functions/pos-members.js");
assert.match(cf, /creditSpinGamePoints/);
assert.match(cf, /issueSpinPlayToken/);
assert.match(cf, /lifetimeGameBonusPoints/);
assert.match(cf, /earn_spin_game/);

assert.match(read("functions/npos-sell.js"), /publicSpinGameCredit/);
assert.match(read("functions/index.js"), /exports\.publicSpinGameCredit/);

assert.match(read("src/app/members/page.tsx"), /จำลองหมุนวงล้อ \(เทส\)/);

const docs = read("docs/members-points-spin.md");
assert.match(docs, /จำนวนช่อง|sliceCount|กะจังหวะ/);
assert.match(docs, /pointsSpinSettings|บันทึก/);
assert.match(docs, /gamesEnabled|publicSpinGameCredit/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 802);

assert.match(lib, /PointTier = 0 \| 1 \| 2 \| 3 \| 4 \| 5/);
assert.match(lib, /points: 0, weight: 50/);
assert.match(read("src/lib/points-spin-theme.ts"), /ไม่ได้แต้มเพิ่ม/);
assert.match(read("src/lib/points-spin-credit.ts"), /points < 0 \|\| points > 5/);
assert.match(read("functions/pos-members.js"), /pts < 0 \|\| pts > 5/);
assert.match(read("src/app/members/spin-demo/page.tsx"), /w0|points: 0/);

// Runtime: default 12 slices · 0 should be the thickest tier
function allocate(weights, target = 12) {
  const map = new Map([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  for (const w of weights) map.set(w.points, (map.get(w.points) || 0) + w.weight);
  const norm = [0, 1, 2, 3, 4, 5]
    .map((points) => ({ points, weight: map.get(points) || 0 }))
    .filter((w) => w.weight > 0);
  const sum = norm.reduce((s, w) => s + w.weight, 0);
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let assigned = 0;
  for (const w of norm) {
    const c = Math.max(1, Math.round((w.weight / sum) * target));
    counts[w.points] = c;
    assigned += c;
  }
  while (assigned > target) {
    const pool = [0, 1, 2, 3, 4, 5]
      .filter((t) => counts[t] > 1)
      .sort((a, b) => counts[b] - counts[a]);
    if (!pool.length) break;
    counts[pool[0]] -= 1;
    assigned -= 1;
  }
  while (assigned < target) {
    const pool = [0, 1, 2, 3, 4, 5]
      .filter((t) => counts[t] > 0)
      .sort((a, b) => counts[b] - counts[a]);
    if (!pool.length) break;
    counts[pool[0]] += 1;
    assigned += 1;
  }
  return counts;
}

const defaults = [
  { points: 0, weight: 50 },
  { points: 1, weight: 25 },
  { points: 2, weight: 12 },
  { points: 3, weight: 7 },
  { points: 4, weight: 4 },
  { points: 5, weight: 2 },
];
const counts = allocate(defaults, 12);
const totalSlices = [0, 1, 2, 3, 4, 5].reduce((s, t) => s + counts[t], 0);
assert.ok(counts[0] >= counts[1], "0 should be most common slice tier");
assert.equal(totalSlices, 12);
assert.ok(360 / totalSlices >= 25, "default slices should be >= ~25° for aiming");

console.log("OK test-members-points-spin");
