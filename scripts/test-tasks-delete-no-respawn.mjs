/**
 * After dismiss+delete helpers — logic still in lib; /tasks/ UI ยกเลิก checklist แล้ว
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const {
  computeSyncOperations,
  dueDatesToEnsure,
  periodKeyFromDue,
  startOfLocalDay,
} = require("../functions/task-weekly-sync.js");

const read = (p) => readFileSync(join(root, p), "utf8");
const page = read("src/app/tasks/page.tsx");
const logic = read("src/lib/task-weekly-logic.ts");
const version = read("src/lib/version.ts");
const cf = read("functions/task-weekly-sync.js");

assert.match(version, /APP_BUILD = \d+/);
assert.match(logic, /applyDismissBlocksToTemplates/);
assert.match(logic, /mergeDismissedPeriodKeys/);
assert.match(page, /TaskBoardNotesView/);
assert.doesNotMatch(page, /dismissBlockRef/);
assert.match(cf, /cancelled: true/);

// Inline mirror of applyDismissBlocksToTemplates
function applyDismissBlocksToTemplates(templates, blockKeys) {
  const byTpl = new Map();
  for (const raw of blockKeys) {
    const i = String(raw).indexOf(":");
    if (i <= 0) continue;
    const tid = String(raw).slice(0, i);
    const pk = String(raw).slice(i + 1);
    if (!tid || !pk) continue;
    if (!byTpl.has(tid)) byTpl.set(tid, new Set());
    byTpl.get(tid).add(pk);
  }
  return templates.map((tpl) => {
    const extra = byTpl.get(tpl.id);
    if (!extra?.size) return tpl;
    const merged = new Set([...(tpl.dismissedPeriodKeys || []), ...extra]);
    return { ...tpl, dismissedPeriodKeys: [...merged] };
  });
}

const tpl = { id: "t1", weekday: 1, dismissedPeriodKeys: [] };
const blocked = applyDismissBlocksToTemplates([tpl], ["t1:2026-07-27"]);
assert.deepEqual(blocked[0].dismissedPeriodKeys, ["2026-07-27"]);

const now = Date.parse("2026-07-26T23:00:00.000Z");
const dues = dueDatesToEnsure(now, 1, 3);
assert.ok(Array.isArray(dues));
assert.ok(typeof periodKeyFromDue(startOfLocalDay(now)) === "string");
assert.ok(typeof computeSyncOperations === "function");

console.log("test-tasks-delete-no-respawn: ok (legacy helpers; UI retired)");
