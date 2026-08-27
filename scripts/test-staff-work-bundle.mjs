import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const bundle = read("src/lib/staff-work-bundle.ts");
const load = read("src/lib/staff-work-load.ts");
const hook = read("src/hooks/useStaffWorkBundle.ts");
const bonus = read("src/app/bonus/page.tsx");
const production = read("src/app/production/page.tsx");

assert.match(bundle, /StaffBonusBundle/);
assert.match(bundle, /isStaffBonusBundleReady/);
assert.match(load, /loadStaffBonusBundleFromServer/);
assert.match(load, /fetchOtEntriesFromServer/);
assert.match(load, /fetchProdEntriesFromServer/);
assert.match(load, /FromServer/);
assert.match(load, /prefetchStaffIdentity/);
assert.match(hook, /useStaffWorkBundle/);
assert.match(bonus, /useStaffWorkBundle/);
assert.match(bonus, /staffBonusReady/);
assert.match(bonus, /staffBonusLoading/);
assert.match(production, /useStaffWorkBundle/);
assert.match(production, /staffProdReady/);

console.log("OK test-staff-work-bundle");
