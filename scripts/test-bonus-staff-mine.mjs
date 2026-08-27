/**
 * Guard: staff bonus must load OT/prod by month then filter client-side
 * (workEntryIncludesMe) — not array-contains workerId alone.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const bonusPage = read("src/app/bonus/page.tsx");
assert.match(bonusPage, /workEntryIncludesMe/);
assert.match(bonusPage, /buildWorkEntryMineIdentity/);
assert.doesNotMatch(
  bonusPage,
  /workerId:\s*selfId/,
  "staff bonus must not query array-contains workerId alone",
);

const mine = read("src/lib/work-entry-mine.ts");
assert.match(mine, /export function workEntryIncludesMe/);
assert.match(mine, /export function buildWorkEntryMineIdentity/);

const employees = read("src/lib/employees.ts");
assert.match(
  employees,
  /const byLink = employees\.find/,
  "resolveLinkedEmployee must prefer canonical link",
);

// Logic: name-only entry still matches when employeeId stale
function namesMatch(a, b) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
function workEntryIncludesMe(entry, me) {
  if (!me) return false;
  const id = (me.employeeId || "").trim();
  if (id && (entry.workerIds || []).includes(id)) return true;
  const aliases = [me.name, me.nickname, me.displayName, ...(me.previousNames || [])].filter(
    (n) => !!n?.trim(),
  );
  return aliases.some((n) => (entry.workerNames || []).some((w) => namesMatch(w, n)));
}

const entry = { workerIds: ["real-a"], workerNames: ["แอน"] };
assert.equal(
  workEntryIncludesMe(entry, { employeeId: "stale-c", name: "แอน" }),
  true,
  "name fallback must catch bakery/OT rows when id stale",
);
assert.equal(
  workEntryIncludesMe(entry, { employeeId: "stale-c", name: "คนอื่น" }),
  false,
);

const version = read("src/lib/version.ts");
assert.match(version, /APP_BUILD = \d+/);

const prodPage = read("src/app/production/page.tsx");
assert.match(prodPage, /workEntryIncludesMe/);
assert.doesNotMatch(prodPage, /workerId: filterId/);

const otPage = read("src/app/ot/page.tsx");
assert.match(otPage, /workEntryIncludesMe/);
assert.match(otPage, /buildWorkEntryMineIdentity/);
assert.match(
  otPage,
  /const entries = allEntries/,
  "staff OT must show full shop grid (team), not filter-away on load",
);

const bonusUtils = read("src/app/bonus/page.tsx");
assert.match(bonusUtils, /bangkokMonthRangeMs/);

console.log("OK test-bonus-staff-mine");
