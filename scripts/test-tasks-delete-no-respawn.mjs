/**
 * After dismiss+delete, client sync must NOT recreate rounds (stale template race).
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

assert.match(version, /APP_BUILD = 519/);
assert.match(logic, /applyDismissBlocksToTemplates/);
assert.match(logic, /mergeDismissedPeriodKeys/);
assert.match(page, /dismissBlockRef/);
assert.match(page, /rememberDismissed/);
assert.match(page, /applyDismissBlocksToTemplates/);
assert.match(page, /อย่า reset syncedRef/);
assert.doesNotMatch(page, /onDeleted[\s\S]{0,200}syncedRef\.current = false/);
assert.match(page, /opts\?\.deleted && opts\.templateId/);

// Inline mirror of applyDismissBlocksToTemplates
function applyDismissBlocksToTemplates(templates, blockKeys) {
  const byTpl = new Map();
  for (const raw of blockKeys) {
    const i = String(raw).indexOf(":");
    if (i <= 0) continue;
    const tid = String(raw).slice(0, i);
    const pk = String(raw).slice(i + 1);
    const arr = byTpl.get(tid) || [];
    arr.push(pk);
    byTpl.set(tid, arr);
  }
  return templates.map((tpl) => {
    const extra = byTpl.get(tpl.id) || [];
    if (!extra.length) return tpl;
    const set = new Set([...(tpl.dismissedPeriodKeys || []), ...extra]);
    return { ...tpl, dismissedPeriodKeys: [...set] };
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const bangkokMon6am = Date.parse("2026-07-26T23:00:00.000Z");
const due = startOfLocalDay(bangkokMon6am);
const pk = periodKeyFromDue(due);

const staleTpl = {
  id: "tpl1",
  active: true,
  weekday: 1,
  openDaysBefore: 3,
  title: "ล้างตู้",
  note: "",
  checklist: [],
  assigneeIds: ["a"],
  assigneeNames: ["เมย์"],
  dismissedPeriodKeys: [], // snapshot ยังไม่ทัน
};

// After delete: no open occurrences left
const afterDeleteOccs = [];

// BUG race: sync with stale template recreates
const bad = computeSyncOperations([staleTpl], afterDeleteOccs, bangkokMon6am);
assert.ok(bad.create.length >= 1, "stale sync would recreate (baseline)");

// FIX: merge dismiss block before sync
const merged = applyDismissBlocksToTemplates([staleTpl], [`tpl1:${pk}`]);
const good = computeSyncOperations(merged, afterDeleteOccs, bangkokMon6am);
assert.equal(good.create.length, 0, "dismiss block must prevent recreate");

// dueDates still wants this Monday
assert.deepEqual(
  dueDatesToEnsure(bangkokMon6am, 1, 3).map((d) => periodKeyFromDue(d)),
  [pk],
);

console.log("test-tasks-delete-no-respawn: ok");
