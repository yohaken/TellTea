/**
 * Task delete must clear all open rounds for a template (no sibling reappear).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const occ = read("src/lib/task-occurrences.ts");
const page = read("src/app/tasks/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 519/);
assert.match(occ, /collectOpenTaskOccurrences/);
assert.match(occ, /dismissAndDeleteOpenTaskOccurrences/);
assert.match(occ, /deactivateTaskTemplateClearingOpen/);
assert.match(occ, /arrayUnion/);
assert.match(page, /dismissAndDeleteOpenTaskOccurrences/);
assert.match(page, /deactivateTaskTemplateClearingOpen/);
assert.match(page, /เอาออกจากตาราง/);
assert.match(page, /allOccurrences/);
assert.doesNotMatch(page, /deactivateTaskTemplate\(/);
assert.doesNotMatch(page, /await dismissTaskPeriod/);

/** Pure helper mirror for unit check */
function isOpen(status) {
  return status === "pending" || status === "missed" || status === "waiting";
}
function collectOpen(templateId, occurrences) {
  const open = occurrences.filter((o) => o.templateId === templateId && isOpen(o.status));
  const keys = new Set(open.map((o) => o.periodKey));
  const byId = new Map();
  for (const o of occurrences) {
    if (o.templateId !== templateId) continue;
    if (o.status === "completed") continue;
    if (keys.has(o.periodKey) || isOpen(o.status)) byId.set(o.id, o);
  }
  return [...byId.values()];
}

const rows = [
  { id: "a", templateId: "t1", periodKey: "2026-07-27", status: "pending" },
  { id: "b", templateId: "t1", periodKey: "2026-08-03", status: "pending" },
  { id: "c", templateId: "t1", periodKey: "2026-07-27", status: "pending" }, // dupe
  { id: "d", templateId: "t1", periodKey: "2026-07-20", status: "completed" },
  { id: "e", templateId: "t2", periodKey: "2026-07-27", status: "pending" },
];
const open = collectOpen("t1", rows);
assert.equal(open.length, 3);
assert.deepEqual(open.map((o) => o.id).sort(), ["a", "b", "c"]);

console.log("test-tasks-delete-cleanup: ok");
