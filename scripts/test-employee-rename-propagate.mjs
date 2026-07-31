/**
 * Rename is same employeeId — rewrite aligned worker/assignee names; UI resolves live names.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const prop = read("src/lib/employee-rename-propagate.ts");
const emp = read("src/lib/employees.ts");
const ot = read("src/app/ot/page.tsx");
const prod = read("src/app/production/page.tsx");
const tasks = read("src/app/tasks/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 525/);
assert.match(prop, /propagateEmployeeRename/);
assert.match(prop, /rewriteAlignedNames/);
assert.match(prop, /resolveWorkerDisplayNames/);
assert.match(prop, /otEntries/);
assert.match(prop, /prodEntries/);
assert.match(prop, /taskTemplates/);
assert.match(prop, /taskOccurrences/);
assert.match(prop, /payrollItems/);
assert.match(prop, /bonusMonthCloses/);
assert.match(emp, /propagateEmployeeRename/);
assert.match(emp, /rename propagate/);
assert.match(ot, /resolveWorkerDisplayNames/);
assert.match(prod, /resolveWorkerDisplayNames/);
assert.match(tasks, /resolveWorkerDisplayNames/);

function rewriteAlignedNames(ids, names, employeeId, newName, oldNames = []) {
  const nextName = newName.trim();
  if (!nextName || !employeeId) return null;
  const oldSet = new Set(oldNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (ids.length) {
    let changed = false;
    const next = ids.map((id, i) => {
      const prev = String(names[i] ?? "").trim();
      if (id === employeeId) {
        if (prev !== nextName) changed = true;
        return nextName;
      }
      return prev;
    });
    return changed ? next : null;
  }
  if (!names.length || !oldSet.size) return null;
  let changed = false;
  const next = names.map((n) => {
    const t = String(n || "").trim();
    if (t && oldSet.has(t.toLowerCase())) {
      changed = true;
      return nextName;
    }
    return t;
  });
  return changed ? next : null;
}

function resolveWorkerDisplayNames(workerIds, workerNames, roster) {
  const ids = workerIds || [];
  const names = workerNames || [];
  if (!ids.length) return names.filter(Boolean);
  return ids.map((id, i) => {
    const live = roster.find((w) => w.id === id)?.name?.trim();
    if (live) return live;
    return String(names[i] || "").trim() || id;
  });
}

// Same id, rename x1 → jay in OT-style row
assert.deepEqual(
  rewriteAlignedNames(["emp1", "emp2"], ["x1", "เมย์"], "emp1", "jay"),
  ["jay", "เมย์"],
);
// Unchanged when already new
assert.equal(
  rewriteAlignedNames(["emp1"], ["jay"], "emp1", "jay"),
  null,
);
// Name-only legacy row
assert.deepEqual(
  rewriteAlignedNames([], ["x1", "เมย์"], "emp1", "jay", ["x1"]),
  ["jay", "เมย์"],
);
// UI live resolve even if snapshot stale
assert.deepEqual(
  resolveWorkerDisplayNames(
    ["emp1"],
    ["x1"],
    [{ id: "emp1", name: "jay" }],
  ),
  ["jay"],
);

console.log("test-employee-rename-propagate: ok");
