/**
 * Legacy task delete helpers still in lib · /tasks/ ไม่เรียกแล้ว
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

assert.match(version, /APP_BUILD = \d+/);
assert.match(occ, /collectOpenTaskOccurrences/);
assert.match(occ, /dismissAndDeleteOpenTaskOccurrences/);
assert.match(occ, /deactivateTaskTemplateClearingOpen/);
assert.match(occ, /arrayUnion/);
assert.match(occ, /sanitizeTaskTemplateId|resolveExistingTaskTemplateRef/);
assert.match(page, /TaskBoardNotesView/);
assert.doesNotMatch(page, /dismissAndDeleteOpenTaskOccurrences/);
assert.doesNotMatch(page, /deactivateTaskTemplateClearingOpen/);

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

const rows = collectOpen("t1", [
  { id: "a", templateId: "t1", periodKey: "2026-01-01", status: "pending" },
  { id: "b", templateId: "t1", periodKey: "2026-01-01", status: "missed" },
  { id: "c", templateId: "t2", periodKey: "2026-01-01", status: "pending" },
]);
assert.equal(rows.length, 2);

console.log("test-tasks-delete-cleanup: ok (legacy helpers; UI retired)");
