/**
 * Nav menu order wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function normalizeNavOrder(input) {
  const keys = ["ledger", "production", "otBonus", "bonus", "checklist", "stock", "more"];
  const out = [];
  for (const raw of input || []) {
    if (keys.includes(raw) && !out.includes(raw)) out.push(raw);
  }
  for (const k of keys) {
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

function sortByNavOrder(items, order) {
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
}

const sorted = sortByNavOrder(
  [
    { key: "stock", label: "คลัง" },
    { key: "ledger", label: "บัญชี" },
    { key: "production", label: "ผลิต" },
  ],
  normalizeNavOrder(["production", "ledger", "stock", "otBonus", "bonus", "checklist", "more"]),
);
assert.deepEqual(
  sorted.map((x) => x.key),
  ["production", "ledger", "stock"],
);

const shellSrc = readFileSync(join(root, "src/components/AppShell.tsx"), "utf8");
const settingsSrc = readFileSync(join(root, "src/app/settings/page.tsx"), "utf8");
assert.match(shellSrc, /subscribeNavOrder/);
assert.match(shellSrc, /sortByNavOrder/);
assert.match(settingsSrc, /NavMenuOrderSetup/);

console.log("OK nav menu order");
