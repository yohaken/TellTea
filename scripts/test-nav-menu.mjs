/**
 * Nav dock + configurable max menu slots.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function normalizeDockTabMax(input) {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return 5;
  return Math.min(8, Math.max(3, Math.round(n)));
}

function normalizeDockTabKeys(input, order, dockTabMax) {
  const keys = ["ledger", "production", "otBonus", "bonus", "checklist", "stock", "assignTasks"];
  const max = normalizeDockTabMax(dockTabMax);
  const out = [];
  for (const raw of input || []) {
    if (keys.includes(raw) && !out.includes(raw)) out.push(raw);
    if (out.length >= max) break;
  }
  if (out.length > 0) return out;
  for (const key of order || keys) {
    if (key === "more") continue;
    if (keys.includes(key) && !out.includes(key)) out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

assert.equal(normalizeDockTabMax(99), 8);
assert.equal(normalizeDockTabMax(2), 3);

const dock5 = normalizeDockTabKeys(
  ["ledger", "production", "otBonus", "bonus", "checklist", "stock"],
  [],
  5,
);
assert.equal(dock5.length, 5);
assert.ok(!dock5.includes("stock"));

const dock7 = normalizeDockTabKeys(
  ["ledger", "production", "otBonus", "bonus", "checklist", "stock", "assignTasks"],
  [],
  7,
);
assert.equal(dock7.length, 7);

const setupSrc = readFileSync(join(root, "src/components/NavMenuOrderSetup.tsx"), "utf8");
const navSrc = readFileSync(join(root, "src/lib/nav-menu.ts"), "utf8");
assert.match(setupSrc, /dockTabMax/);
assert.match(navSrc, /dockTabMax/);

console.log("OK nav dock menu");
