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
  const keys = ["ledger", "production", "bakerySop", "otBonus", "bonus", "checklist", "stock", "assignTasks"];
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
  ["ledger", "production", "bakerySop", "otBonus", "bonus", "checklist", "stock"],
  [],
  7,
);
assert.equal(dock7.length, 7);

const setupSrc = readFileSync(join(root, "src/components/NavMenuOrderSetup.tsx"), "utf8");
const navSrc = readFileSync(join(root, "src/lib/nav-menu.ts"), "utf8");
assert.match(setupSrc, /dockTabMax/);
assert.match(setupSrc, /moveDockModule/);
assert.match(navSrc, /dockTabMax/);
assert.match(navSrc, /bakerySop/);
assert.match(navSrc, /\/bakery-sop\//);
assert.match(navSrc, /moveDockModule/);

function sortByNavOrder(items, order) {
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
}

function orderedDockKeys(dockTabKeys, navOrder) {
  return sortByNavOrder(
    dockTabKeys.map((key) => ({ key })),
    navOrder,
  ).map((row) => row.key);
}

function moveDockModule(ui, key, dir) {
  const dockOrdered = orderedDockKeys(ui.dockTabKeys, ui.navOrder);
  const idx = dockOrdered.indexOf(key);
  if (idx < 0) return null;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= dockOrdered.length) return null;
  const swapWith = dockOrdered[swapIdx];
  const nextDock = [...dockOrdered];
  [nextDock[idx], nextDock[swapIdx]] = [nextDock[swapIdx], nextDock[idx]];
  const nextNavOrder = [...ui.navOrder];
  const a = nextNavOrder.indexOf(key);
  const b = nextNavOrder.indexOf(swapWith);
  if (a < 0 || b < 0) return null;
  [nextNavOrder[a], nextNavOrder[b]] = [nextNavOrder[b], nextNavOrder[a]];
  return { navOrder: nextNavOrder, dockTabKeys: nextDock };
}

// แถบล่างเรียงตาม navOrder — ↑↓ ต้องสลับ navOrder ด้วยถึงจะเห็นผล
const ui = {
  navOrder: ["bonus", "checklist", "otBonus", "production", "ledger", "stock", "assignTasks", "bakerySop", "more"],
  dockTabKeys: ["bonus", "checklist", "otBonus", "production", "ledger", "stock", "assignTasks", "bakerySop"],
  dockTabMax: 8,
};
const afterUp = moveDockModule(ui, "bakerySop", -1);
assert.ok(afterUp);
assert.deepEqual(afterUp.dockTabKeys.slice(-2), ["bakerySop", "assignTasks"]);
assert.ok(afterUp.navOrder.indexOf("bakerySop") < afterUp.navOrder.indexOf("assignTasks"));

let step = { ...ui };
for (let i = 0; i < 3; i++) {
  const next = moveDockModule(step, "bakerySop", -1);
  assert.ok(next);
  step = { ...step, ...next };
}
assert.equal(step.dockTabKeys[step.dockTabKeys.indexOf("production") + 1], "bakerySop");

console.log("OK nav dock menu");
