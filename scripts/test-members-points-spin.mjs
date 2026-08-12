/**
 * Guard: points multiplier game suite — wheel + brand logo + points-only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

const root = pathJoin(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(pathJoin(root, p), "utf8");

const lib = read("src/lib/points-multiplier-spin.ts");
assert.match(lib, /DEFAULT_SPIN_WEIGHTS/);
assert.match(lib, /pickMultiplier/);
assert.match(lib, /buildWheelSlices/);
assert.match(lib, /wheelTargetRotation/);

const games = read("src/lib/points-games.ts");
assert.match(games, /PointsGameId/);
assert.match(games, /POINTS_GAMES_CUSTOMER_LIVE\s*=\s*false/);
assert.match(games, /หมุนวงล้อคูณแต้ม/);
assert.match(games, /ป้อนไข่มุก/);
assert.match(games, /เทชาลุ้นคูณแต้ม|เทชา/);
assert.match(games, /คูณแต้มเท่านั้น|ไม่ใช่ของแถม/);

const theme = read("src/lib/points-spin-theme.ts");
assert.match(theme, /POINTS_ONLY_NOTE/);
assert.match(theme, /คูณแต้มเท่านั้น/);
assert.doesNotMatch(theme, /ชิโอปัง|ซอฟคุกกี้|บราวนี่/);

const brand = read("src/components/PointsGameBrandLogo.tsx");
assert.match(brand, /loadBrandLogo/);
assert.match(brand, /meta\/brandLogo|brandLogo/);

assert.match(read("src/components/PointsGamesAttractBg.tsx"), /PointsMultiplierSpin/);
assert.match(read("src/components/PointsGamesAttractBg.tsx"), /PointsFeedBobaGame/);
assert.match(read("src/components/PointsGamesAttractBg.tsx"), /PointsPourTeaGame/);
assert.match(read("src/components/PointsGameOnce.tsx"), /เลือก 1 เกม/);
assert.match(read("src/components/PointsGameOnce.tsx"), /เปลี่ยนเกมไม่ได้|รอบนี้เลือกเกมไปแล้ว/);
assert.match(read("src/components/PointsGameOnce.tsx"), /PointsGameBrandLogo/);
assert.doesNotMatch(read("src/components/PointsGameOnce.tsx"), /SpinPrizeIcon/);

// React 19.1 in this repo has no useEffectEvent — must not crash client bundle.
const spinUi = read("src/components/PointsMultiplierSpin.tsx");
assert.doesNotMatch(spinUi, /\buseEffectEvent\s*\(/);
assert.doesNotMatch(spinUi, /import\s*\{[^}]*\buseEffectEvent\b/);
assert.match(spinUi, /onCompleteRef/);
assert.match(spinUi, /pts-wheel|หมุนวงล้อ/);
assert.match(spinUi, /PointsGameBrandLogo/);
assert.match(spinUi, /POINTS_ONLY_NOTE/);

const feedUi = read("src/components/PointsFeedBobaGame.tsx");
assert.match(feedUi, /PointsGameBrandLogo/);
assert.match(feedUi, /POINTS_ONLY_NOTE/);
assert.match(feedUi, /mode/);

const pourUi = read("src/components/PointsPourTeaGame.tsx");
assert.match(pourUi, /PointsGameBrandLogo/);
assert.match(pourUi, /POINTS_ONLY_NOTE/);
assert.match(pourUi, /mode/);

const css = read("src/app/globals.css");
assert.match(css, /\.pts-wheel-stage/);
assert.match(css, /\.pts-wheel-disc/);
assert.match(css, /\.pts-wheel-hub/);

const claim = read("src/app/claim/page.tsx");
assert.match(claim, /POINTS_GAMES_CUSTOMER_LIVE/);
assert.match(claim, /PointsGamesAttractBg/);
assert.match(claim, /PointsGameOnce/);
assert.doesNotMatch(claim, /from \"@\/components\/PointsMultiplierSpin\"/);

const join = read("src/app/join/page.tsx");
assert.match(join, /POINTS_GAMES_CUSTOMER_LIVE/);
assert.match(join, /PointsGamesAttractBg/);
assert.match(join, /PointsGameOnce/);

const demo = read("src/app/members/spin-demo/page.tsx");
assert.match(demo, /โฟลว์ลูกค้า/);
assert.match(demo, /ทดลองหลังร้านเท่านั้น/);
assert.match(demo, /ยังไม่เปิดในลิงก์ลูกค้า/);
assert.match(demo, /PointsGamesAttractBg/);
assert.match(demo, /PointsGameOnce/);
assert.match(demo, /allowReselect/);

assert.match(read("src/app/members/page.tsx"), /spin-demo/);
assert.match(read("src/app/members/page.tsx"), /จำลองคูณแต้ม \(เทส\)/);
assert.match(read("docs/members-points-spin.md"), /POINTS_GAMES_CUSTOMER_LIVE/);
assert.match(read("docs/members-points-spin.md"), /ยังไม่เปิดลูกค้า|ปิด/);
assert.match(read("docs/members-points-spin.md"), /วงล้อ|วงกลม/);
assert.match(read("docs/members-points-spin.md"), /brandLogo|ใบเสร็จ/);
assert.match(read("docs/members-points-spin.md"), /คูณแต้มเท่านั้น/);

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 794);

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
