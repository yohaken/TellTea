/**
 * Ledger / owner-books UI lists must always show date newest → oldest
 * (including search pools that arrive oldest→newest from Firestore).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const smart = read("src/lib/smart-search.ts");
const ledgerPage = read("src/app/ledger/page.tsx");
const ownerPage = read("src/app/owner-books/page.tsx");
const version = read("src/lib/version.ts");
const ledgerLib = read("src/lib/ledger.ts");

assert.match(smart, /export function sortByDateNewestFirst/);
assert.match(
  smart,
  /b\.date - a\.date \|\| \(b\.createdAt \|\| 0\) - \(a\.createdAt \|\| 0\)/,
);

assert.match(ledgerPage, /sortByDateNewestFirst/);
assert.match(
  ledgerPage,
  /sortByDateNewestFirst\(filterLedgerRows\(source, deferredQuery\)\)/,
);

assert.match(ownerPage, /sortByDateNewestFirst/);
assert.match(
  ownerPage,
  /sortByDateNewestFirst\(filterOwnerBookRows\(source, deferredQuery\)\)/,
);

// Live feed stays newest-first from Firestore.
assert.match(
  ledgerLib,
  /orderBy\("date", "desc"\)[\s\S]*orderBy\("createdAt", "desc"\)/,
);

assert.match(version, /APP_BUILD = 462/);

// Runtime check of the same comparator the helper uses.
function sortByDateNewestFirst(rows) {
  return [...rows].sort(
    (a, b) => b.date - a.date || (b.createdAt || 0) - (a.createdAt || 0),
  );
}

const pool = [
  { id: "a", date: 100, createdAt: 1 },
  { id: "b", date: 300, createdAt: 2 },
  { id: "c", date: 200, createdAt: 9 },
  { id: "d", date: 300, createdAt: 5 },
];
assert.deepEqual(
  sortByDateNewestFirst(pool).map((r) => r.id),
  ["d", "b", "c", "a"],
);

console.log("OK test-ledger-date-newest-first");
