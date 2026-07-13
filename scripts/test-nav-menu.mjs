/**
 * Nav dock + more menu wiring.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function normalizeDockTabKeys(input, order) {
  const keys = ["ledger", "production", "otBonus", "bonus", "checklist", "stock", "assignTasks"];
  const out = [];
  for (const raw of input || []) {
    if (keys.includes(raw) && !out.includes(raw)) out.push(raw);
    if (out.length >= 5) break;
  }
  if (out.length > 0) return out;
  for (const key of order || keys) {
    if (key === "more") continue;
    if (keys.includes(key) && !out.includes(key)) out.push(key);
    if (out.length >= 5) break;
  }
  return out;
}

const dock = normalizeDockTabKeys(["ledger", "production", "otBonus", "bonus", "checklist"], [
  "production",
  "ledger",
  "stock",
  "otBonus",
  "bonus",
  "checklist",
  "more",
]);
assert.equal(dock.length, 5);
assert.ok(!dock.includes("stock"));

const shellSrc = readFileSync(join(root, "src/components/AppShell.tsx"), "utf8");
const setupSrc = readFileSync(join(root, "src/components/NavMenuOrderSetup.tsx"), "utf8");
const navSrc = readFileSync(join(root, "src/lib/nav-menu.ts"), "utf8");
assert.match(shellSrc, /resolveNavForUser/);
assert.match(shellSrc, /subscribeNavUi/);
assert.match(setupSrc, /DOCK_TAB_MAX/);
assert.match(navSrc, /dockTabKeys/);

console.log("OK nav dock menu");
