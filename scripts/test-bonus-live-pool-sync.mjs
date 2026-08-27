/**
 * Guard: bonus live pool auto-sync (Cloud Functions + client subscribe retry).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const sync = read("functions/bonus-live-pool-sync.js");
assert.match(sync, /refreshBonusLivePoolForMonth/);
assert.match(sync, /onProdEntryWrittenForBonusPool/);
assert.match(sync, /onOtEntryWrittenForBonusPool/);
assert.match(sync, /bonusLivePoolHourly/);
assert.match(sync, /bonusLivePool\/\$\{periodMonth\}/);

const index = read("functions/index.js");
assert.match(index, /bonus-live-pool-sync/);
assert.match(index, /onProdEntryWrittenForBonusPool/);

const pool = read("src/lib/bonus-live-pool.ts");
assert.match(pool, /attempt < 3/);

const bonusPage = read("src/app/bonus/page.tsx");
assert.doesNotMatch(
  bonusPage,
  /เจ้าของเปิดหน้านี้ในเดือนนี้/,
  "staff must not depend on owner opening bonus page",
);

console.log("OK test-bonus-live-pool-sync");
