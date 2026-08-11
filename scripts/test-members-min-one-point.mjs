/**
 * Any positive paid total earns at least 1 point (small SKUs ~13฿).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const client = read("src/lib/members.ts");
assert.match(client, /Math\.max\(1,\s*Math\.floor\(amountBaht \/ settings\.bahtPerPoint\)\)/);

const server = read("functions/pos-members.js");
assert.match(server, /Math\.max\(1,\s*Math\.floor\(amountBaht \/ settings\.bahtPerPoint\)\)/);

const docs = read("docs/members-round-phases.md");
assert.match(docs, /max\(1,\s*floor/);
assert.match(docs, /13฿|13 ?฿/);

const page = read("src/app/members/page.tsx");
assert.match(page, /ขั้นต่ำ 1 แต้ม/);

// Mirror formula without Firebase settings object wiring.
function pointsFromSaleAmount(amountBaht, { enabled = true, bahtPerPoint = 25 } = {}) {
  if (!enabled || !(bahtPerPoint > 0)) return 0;
  if (!(amountBaht > 0)) return 0;
  return Math.max(1, Math.floor(amountBaht / bahtPerPoint));
}

assert.equal(pointsFromSaleAmount(13, { bahtPerPoint: 25 }), 1);
assert.equal(pointsFromSaleAmount(13, { bahtPerPoint: 33 }), 1);
assert.equal(pointsFromSaleAmount(24, { bahtPerPoint: 25 }), 1);
assert.equal(pointsFromSaleAmount(25, { bahtPerPoint: 25 }), 1);
assert.equal(pointsFromSaleAmount(49, { bahtPerPoint: 25 }), 1);
assert.equal(pointsFromSaleAmount(50, { bahtPerPoint: 25 }), 2);
assert.equal(pointsFromSaleAmount(99, { bahtPerPoint: 33 }), 3);
assert.equal(pointsFromSaleAmount(0, { bahtPerPoint: 25 }), 0);
assert.equal(pointsFromSaleAmount(13, { enabled: false, bahtPerPoint: 25 }), 0);

// Server export smoke (same math)
const require = createRequire(import.meta.url);
const fn = require(join(root, "functions/pos-members.js"));
if (typeof fn.pointsFromSaleAmount === "function") {
  assert.equal(
    fn.pointsFromSaleAmount(13, { enabled: true, bahtPerPoint: 33 }),
    1,
  );
  assert.equal(
    fn.pointsFromSaleAmount(0, { enabled: true, bahtPerPoint: 33 }),
    0,
  );
}

const version = read("src/lib/version.ts");
assert.ok(Number(version.match(/APP_BUILD\s*=\s*(\d+)/)?.[1] || 0) >= 772);

console.log("OK test-members-min-one-point");
